<?php

declare(strict_types=1);

namespace Komato\Api\Middleware;

use Komato\Api\Config\Env;
use Komato\Api\Http\ApiException;
use Komato\Api\Repository\RateLimitRepository;
use Komato\Api\Support\Clock;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Per-IP rate limiting for write endpoints.
 *
 * Context: the game is handed out by QR code to a whole school, so a single NAT
 * address can legitimately carry a lot of players. The limit is therefore generous -
 * it exists to stop a script, not to throttle a classroom.
 *
 * Client IPs are hashed before storage (see `RateLimitRepository`), so the table
 * holds no personal data.
 */
final class RateLimitMiddleware implements MiddlewareInterface
{
    public function __construct(
        private readonly RateLimitRepository $repository,
        private readonly Clock $clock,
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if ($request->getMethod() !== 'POST') {
            return $handler->handle($request);
        }

        $limit = Env::int('RATE_LIMIT_PER_WINDOW', 120);
        $window = Env::int('RATE_LIMIT_WINDOW_SECONDS', 60);
        if ($limit <= 0) {
            return $handler->handle($request);
        }

        $bucket = $this->clientIp($request) . '|' . $request->getUri()->getPath();
        $result = $this->repository->hit($bucket, $limit, $window, $this->clock->now());

        if (!$result['allowed']) {
            throw ApiException::tooManyRequests(
                'リクエストが多すぎます。少し待ってからもう一度お試しください',
                $result['retryAfter'],
            );
        }

        return $handler->handle($request);
    }

    /**
     * The client address.
     *
     * `X-Forwarded-For` is honoured ONLY when `TRUSTED_PROXY` is enabled, because a
     * client can set that header freely - trusting it unconditionally would make the
     * rate limit trivially bypassable.
     */
    private function clientIp(ServerRequestInterface $request): string
    {
        if (Env::bool('TRUSTED_PROXY')) {
            $forwarded = $request->getHeaderLine('X-Forwarded-For');
            if ($forwarded !== '') {
                $first = trim(explode(',', $forwarded)[0]);
                if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                    return $first;
                }
            }
        }

        $server = $request->getServerParams();
        $remote = $server['REMOTE_ADDR'] ?? '';

        return is_string($remote) && $remote !== '' ? $remote : 'unknown';
    }
}
