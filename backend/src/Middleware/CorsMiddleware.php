<?php

declare(strict_types=1);

namespace Komato\Api\Middleware;

use Komato\Api\Config\Env;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * CORS - intentionally restrictive.
 *
 * In production the frontend is served from the SAME origin as `/api`, so no CORS
 * headers are needed at all and `CORS_ALLOWED_ORIGINS` stays empty. The setting
 * exists for split-origin development and staging only, and it never echoes an
 * arbitrary Origin back: the request is matched against an explicit allow-list.
 *
 * Preflight is answered here rather than by a catch-all `OPTIONS` route, because a
 * catch-all route would make every unknown path report 405 instead of 404.
 */
final class CorsMiddleware implements MiddlewareInterface
{
    public function __construct(private readonly ResponseFactoryInterface $responseFactory)
    {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $allowed = Env::list('CORS_ALLOWED_ORIGINS');
        $origin = $request->getHeaderLine('Origin');
        $isAllowed = $origin !== '' && in_array($origin, $allowed, true);

        if ($request->getMethod() === 'OPTIONS' && $isAllowed) {
            return $this->decorate($this->responseFactory->createResponse(204), $origin);
        }

        $response = $handler->handle($request);

        return $isAllowed ? $this->decorate($response, $origin) : $response;
    }

    private function decorate(ResponseInterface $response, string $origin): ResponseInterface
    {
        return $response
            ->withHeader('Access-Control-Allow-Origin', $origin)
            ->withHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            ->withHeader('Access-Control-Allow-Headers', 'Content-Type')
            ->withHeader('Access-Control-Max-Age', '600')
            // Different origins must not share a cached response.
            ->withHeader('Vary', 'Origin');
    }
}
