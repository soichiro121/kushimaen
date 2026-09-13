<?php

declare(strict_types=1);

namespace Komato\Api\Service;

use Komato\Api\Repository\ScoreRepository;
use Komato\Api\Support\Clock;

/**
 * Leaderboard reads.
 *
 * Ranking lives in the repository (it is a SQL concern); this service shapes the
 * response and marks the caller's own row.
 */
final class LeaderboardService
{
    public const DEFAULT_LIMIT = 50;
    public const MAX_LIMIT = 100;

    public function __construct(
        private readonly ScoreRepository $scores,
        private readonly Clock $clock,
    ) {
    }

    /**
     * @return array{period: string, entries: list<array<string, mixed>>, me: array<string, mixed>|null, total: int}
     */
    public function board(string $period, int $limit, ?string $runId): array
    {
        $period = $period === 'today' ? 'today' : 'all';
        $limit = max(1, min($limit, self::MAX_LIMIT));
        $now = $this->clock->now();

        $rows = $this->scores->top($period, $limit, $now);
        $entries = array_map(
            static fn (array $row): array => [
                'rank' => $row['rank'],
                'nickname' => $row['nickname'],
                'totalScore' => $row['totalScore'],
                'createdAt' => $row['createdAt'],
                'isMe' => $runId !== null && $row['runId'] === $runId,
            ],
            $rows,
        );

        $me = null;
        if ($runId !== null) {
            $placement = $this->scores->placementOf($runId, $period, $now);
            if ($placement !== null) {
                $me = [
                    'rank' => $placement['rank'],
                    'nickname' => $placement['nickname'],
                    'totalScore' => $placement['totalScore'],
                    'createdAt' => $placement['createdAt'],
                    'isMe' => true,
                ];
            }
        }

        return [
            'period' => $period,
            'entries' => $entries,
            'me' => $me,
            'total' => $this->scores->countValid($period, $now),
        ];
    }
}
