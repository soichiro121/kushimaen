/**
 * Run lifecycle: open a run, then close it with a validated, recomputed score.
 *
 * The routes do none of this work themselves - they parse the request and hand over.
 * That keeps the anti-cheat pipeline in one readable place:
 *
 *   request shape  ->  run state  ->  stage results  ->  score  ->  leaderboard
 *
 * THE PROMISE THIS KEEPS: the client's `totalScore` is never stored. Every stage is
 * rescored here from the submitted metrics using `shared/core/scoring.ts` - the same
 * module the game itself uses to draw the number on screen - so the two cannot
 * disagree, and a forged total is simply ignored.
 */
import { RULES } from '../../shared/core/rules.js';
import { validateSubmission } from '../../shared/core/validation.js';
import type {
  CompleteRunResponse,
  CreateRunResponse,
  StageSubmission,
} from '../../shared/core/api.js';
import { RUN_STATUS, isExpiredAt, isOpen, type Run } from '../domain/run.js';
import { findRun, insertRun, markRunCompleted } from '../repository/runs.js';
import { insertScore, placementOf } from '../repository/scores.js';
import { insertStageResults } from '../repository/stageResults.js';
import { sanitizeNickname, validateNickname } from '../../shared/core/nickname.js';
import { ApiError } from '../http/apiError.js';
import { newRunId, newSeed } from '../support/ids.js';
import { logger } from '../support/logger.js';
import type { Database } from '../db/types.js';
import type { Clock } from '../support/clock.js';

/**
 * Opens a run.
 *
 * The id and the seed both come from the server: a client that chose its own seed
 * could scout an easy layout, and one that invented a run id could submit a score for
 * a game it never started.
 */
export async function createRun(db: Database, clock: Clock): Promise<CreateRunResponse> {
  const now = clock.now();
  const run: Run = {
    id: newRunId(),
    seed: newSeed(),
    configVersion: RULES.configVersion,
    startedAt: now,
    expiresAt: new Date(now.getTime() + RULES.run.ttlSeconds * 1000),
    completedAt: null,
    status: RUN_STATUS.open,
  };

  await insertRun(db, run);

  return {
    runId: run.id,
    seed: run.seed,
    configVersion: run.configVersion,
    expiresAt: run.expiresAt.toISOString(),
    serverTime: now.toISOString(),
  };
}

export async function completeRun(
  db: Database,
  clock: Clock,
  runId: string,
  rawNickname: string,
  stages: readonly StageSubmission[],
  clientTotal: number,
): Promise<CompleteRunResponse> {
  const now = clock.now();
  const run = await findRun(db, runId);

  if (run === null) {
    throw ApiError.notFound('unknown_run', 'このプレイは見つかりませんでした');
  }
  if (!isOpen(run)) {
    throw ApiError.conflict('run_already_completed', 'このプレイのスコアは登録済みです');
  }
  if (isExpiredAt(run, now)) {
    // Close it so the id cannot be retried later.
    await markRunCompleted(db, runId, now, RUN_STATUS.rejected);
    throw ApiError.gone('run_expired', 'プレイの有効期限が切れました。もう一度遊んでください');
  }
  if (run.configVersion !== RULES.configVersion) {
    throw ApiError.conflict(
      'config_version_mismatch',
      'ゲームが更新されました。ページを再読み込みしてください',
    );
  }

  if (validateNickname(rawNickname) !== null) {
    throw ApiError.unprocessable('invalid_nickname', 'ニックネームを確認してください');
  }
  const nickname = sanitizeNickname(rawNickname);

  const outcome = validateSubmission(stages);

  // One transaction: a run is either closed WITH its rows written, or neither.
  await db.transaction(async (tx) => {
    const claimed = await markRunCompleted(
      tx,
      runId,
      now,
      outcome.valid ? RUN_STATUS.completed : RUN_STATUS.rejected,
    );
    if (!claimed) {
      // Another request closed it between our read and this update.
      throw ApiError.conflict('run_already_completed', 'このプレイのスコアは登録済みです');
    }

    await insertStageResults(tx, runId, stages, outcome.stageScores);
    await insertScore(tx, {
      runId,
      nickname,
      totalScore: outcome.totalScore,
      createdAt: now,
      valid: outcome.valid,
      suspicionScore: outcome.suspicionScore,
      configVersion: run.configVersion,
    });
  });

  if (!outcome.valid || outcome.issues.length > 0) {
    logger.warn('suspicious submission', {
      runId,
      clientTotal,
      serverTotal: outcome.totalScore,
      suspicion: outcome.suspicionScore,
      issues: outcome.issues.map((issue) => issue.code),
    });
  }

  const placement = outcome.valid
    ? await placementOf(db, run.configVersion, runId, 'all', now)
    : null;

  return {
    accepted: outcome.valid,
    totalScore: outcome.totalScore,
    stageScores: outcome.stageScores as Record<string, number>,
    rank: placement?.rank ?? null,
    ...(outcome.valid ? {} : { notice: 'スコアを検証できませんでした' }),
  };
}
