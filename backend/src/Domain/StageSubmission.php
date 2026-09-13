<?php

declare(strict_types=1);

namespace Komato\Api\Domain;

/**
 * One stage's result as submitted by the client.
 *
 * `$score` is the CLIENT's number and is kept only for comparison and telemetry -
 * it is never what goes on the leaderboard.
 */
final class StageSubmission
{
    /** @param array<string, float|int> $metrics */
    public function __construct(
        public readonly string $stageId,
        public readonly int $score,
        public readonly int $durationMs,
        public readonly array $metrics,
    ) {
    }

    public function metric(string $key): float
    {
        $value = $this->metrics[$key] ?? 0;
        return is_int($value) || is_float($value) ? (float) $value : 0.0;
    }
}
