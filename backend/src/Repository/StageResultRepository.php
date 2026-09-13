<?php

declare(strict_types=1);

namespace Komato\Api\Repository;

use Komato\Api\Domain\StageSubmission;
use PDO;

/**
 * Per-stage rows.
 *
 * Kept for two reasons: balance analysis (which stage is too hard?) and abuse
 * review (a suspicious total can be traced back to the metric that caused it).
 * `score` here is the SERVER-recomputed value, not the client's.
 */
final class StageResultRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param list<StageSubmission> $stages
     * @param array<string, int>    $serverScores server-recomputed, keyed by stage id
     */
    public function insertMany(string $runId, array $stages, array $serverScores): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO stage_results (run_id, stage_id, score, client_score, duration_ms, metrics_json)
             VALUES (:run_id, :stage_id, :score, :client_score, :duration_ms, :metrics_json)'
        );

        $written = [];
        foreach ($stages as $stage) {
            // A repeated stage is a validation failure, not a crash: the submission is
            // still stored for review, keeping the first row per stage.
            if (isset($written[$stage->stageId])) {
                continue;
            }
            $written[$stage->stageId] = true;

            $statement->execute([
                ':run_id' => $runId,
                ':stage_id' => $stage->stageId,
                ':score' => $serverScores[$stage->stageId] ?? 0,
                ':client_score' => $stage->score,
                ':duration_ms' => $stage->durationMs,
                ':metrics_json' => json_encode($stage->metrics, JSON_THROW_ON_ERROR),
            ]);
        }
    }

    /** @return list<array<string, mixed>> */
    public function forRun(string $runId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT stage_id, score, client_score, duration_ms, metrics_json
             FROM stage_results WHERE run_id = :run_id ORDER BY id ASC'
        );
        $statement->execute([':run_id' => $runId]);

        return $statement->fetchAll();
    }
}
