<?php

declare(strict_types=1);

namespace Komato\Api\Controller;

use Komato\Api\Config\RuleSet;
use Komato\Api\Http\Json;
use Komato\Api\Support\Clock;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `GET /api/health`
 *
 * The frontend probes this on startup to decide between remote and LOCAL MODE, so it
 * must stay cheap and must not touch the database on the happy path.
 */
final class HealthController
{
    public function __construct(
        private readonly RuleSet $rules,
        private readonly Clock $clock,
    ) {
    }

    public function __invoke(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, [
            'status' => 'ok',
            'configVersion' => $this->rules->configVersion(),
            'serverTime' => $this->clock->now()->format(DATE_ATOM),
        ]);
    }
}
