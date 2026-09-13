<?php

declare(strict_types=1);

namespace Komato\Api\Controller;

use Komato\Api\Http\Json;
use Komato\Api\Service\LeaderboardService;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/** `GET /api/leaderboard?period=today|all&limit=50&runId=...` */
final class LeaderboardController
{
    public function __construct(private readonly LeaderboardService $leaderboard)
    {
    }

    public function __invoke(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $query = $request->getQueryParams();

        $period = is_string($query['period'] ?? null) ? $query['period'] : 'today';
        $limit = (int) ($query['limit'] ?? LeaderboardService::DEFAULT_LIMIT);

        $runId = null;
        if (is_string($query['runId'] ?? null) && preg_match('/^[0-9a-fA-F-]{36}$/', $query['runId'])) {
            $runId = $query['runId'];
        }

        return Json::write($response, $this->leaderboard->board($period, $limit, $runId));
    }
}
