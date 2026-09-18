/**
 * Per-stage rows.
 *
 * Kept for two reasons: balance analysis (which stage is too hard?) and abuse review
 * (a suspicious total can be traced back to the metric that produced it).
 *
 * `score` here is the SERVER-recomputed value. `client_score` is what the client
 * claimed, stored alongside it precisely so the two can be compared later.
 */
import type { SqlClient } from '../db/types';
import type { StageSubmission } from '../../shared/core/api';

export async function insertStageResults(
  db: SqlClient,
  runId: string,
  stages: readonly StageSubmission[],
  serverScores: Readonly<Record<string, number>>,
): Promise<void> {
  const written = new Set<string>();

  for (const stage of stages) {
    // A repeated stage is a validation failure, not a crash: the submission is still
    // stored for review, keeping the first row per stage.
    if (written.has(stage.stageId)) continue;
    written.add(stage.stageId);

    await db.query(
      `INSERT INTO stage_results (run_id, stage_id, score, client_score, duration_ms, metrics_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        runId,
        stage.stageId,
        serverScores[stage.stageId] ?? 0,
        Math.trunc(stage.score),
        Math.trunc(stage.durationMs),
        JSON.stringify(stage.metrics),
      ],
    );
  }
}
