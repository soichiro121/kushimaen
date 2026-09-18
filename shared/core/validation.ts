/**
 * Submission validation - the anti-cheat gate.
 *
 * ONE implementation, run in TWO places: the API route calls it to decide what goes
 * on the leaderboard (authoritative), and the client calls it so LOCAL MODE behaves
 * the same way offline. It used to be written twice, once here and once in the
 * backend; that is exactly the drift risk this file now removes.
 *
 * The goal is explicitly NOT perfect cheat prevention - impossible for a client-side
 * game. The goal is that editing `totalScore` in DevTools and POSTing it cannot put
 * you on top of the board. A forger has to submit a self-consistent set of metrics
 * that are all within human limits, which is a far higher bar than editing a number.
 */
import { RULES, type StageId } from './rules';
import { computeStageScore, maxPlausibleStageScore } from './scoring';
import type { StageSubmission } from './api';

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  /** How much this issue contributes to the suspicion score (0-100). */
  readonly weight: number;
}

export interface ValidationOutcome {
  /** False means the entry must not enter the leaderboard. */
  readonly valid: boolean;
  /** Server-recomputed total. Never the client's number. */
  readonly totalScore: number;
  readonly stageScores: Readonly<Record<string, number>>;
  readonly issues: readonly ValidationIssue[];
  /** 0 = clean, 100 = certainly tampered. Entries above `REJECT_THRESHOLD` are dropped. */
  readonly suspicionScore: number;
}

export const REJECT_THRESHOLD = 50;

function isStageId(value: string): value is StageId {
  return Object.prototype.hasOwnProperty.call(RULES.stages, value);
}

/** Metric bounds that cannot be expressed as a simple constant in the rule set. */
function metricIssues(stageId: StageId, metrics: Record<string, number>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const read = (key: string): number => {
    const value = metrics[key];
    return Number.isFinite(value) ? (value as number) : 0;
  };

  for (const [key, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value)) {
      issues.push({
        code: 'metric_not_finite',
        message: `metric ${key} is not finite`,
        weight: 100,
      });
    } else if (value < 0) {
      issues.push({ code: 'metric_negative', message: `metric ${key} is negative`, weight: 100 });
    }
  }

  switch (stageId) {
    case 'late': {
      const cfg = RULES.stages.late;
      if (read('nearMissCount') > cfg.limits.maxNearMissCount) {
        issues.push({
          code: 'late_near_miss',
          message: 'nearMissCount above the cap',
          weight: 100,
        });
      }
      if (read('collisionCount') > cfg.limits.maxCollisionCount) {
        issues.push({
          code: 'late_collisions',
          message: 'collisionCount above the cap',
          weight: 60,
        });
      }
      if (read('comboUnits') > read('nearMissCount') * cfg.scoring.maxComboUnitsPerHit) {
        issues.push({
          code: 'late_combo_units',
          message: 'comboUnits exceed what nearMissCount allows',
          weight: 100,
        });
      }
      if (read('timeRemainingSec') > cfg.limits.maxTimeRemainingSec) {
        issues.push({
          code: 'late_time_remaining',
          message: 'timeRemainingSec above the time limit',
          weight: 100,
        });
      }
      if (read('goalReached') > 1) {
        issues.push({ code: 'late_goal', message: 'goalReached must be 0 or 1', weight: 100 });
      }
      if (read('timeRemainingSec') > 0 && read('goalReached') < 1) {
        issues.push({
          code: 'late_time_without_goal',
          message: 'time bonus without reaching the gate',
          weight: 100,
        });
      }
      break;
    }
    case 'bread': {
      const cfg = RULES.stages.bread;
      const questions = read('questionCount');
      if (questions < cfg.minQuestions || questions > cfg.maxQuestions) {
        issues.push({
          code: 'bread_questions',
          message: 'questionCount outside the configured range',
          weight: 100,
        });
      }
      if (read('correctCount') > questions) {
        issues.push({
          code: 'bread_correct',
          message: 'more correct answers than questions',
          weight: 100,
        });
      }
      if (read('speedUnits') > read('correctCount') * cfg.maxSpeedUnitsPerQuestion) {
        issues.push({
          code: 'bread_speed_units',
          message: 'speedUnits exceed what correctCount allows',
          weight: 100,
        });
      }
      if (read('comboUnits') > read('correctCount') * cfg.scoring.maxComboUnitsPerHit) {
        issues.push({
          code: 'bread_combo_units',
          message: 'comboUnits exceed what correctCount allows',
          weight: 100,
        });
      }
      if (read('mistakeCount') > cfg.limits.maxMistakeCount) {
        issues.push({ code: 'bread_mistakes', message: 'mistakeCount above the cap', weight: 60 });
      }
      break;
    }
    case 'teacher': {
      // Stage 3 has no per-action counters to bound; the checks are about internal
      // consistency instead.
      const cfg = RULES.stages.teacher;
      const cleared = read('cleared');
      const caught = read('caughtCount');
      const detections = read('detectionCount');
      const timeRemaining = read('timeRemainingSec');

      if (cleared > 1) {
        issues.push({
          code: 'teacher_cleared_flag',
          message: 'cleared must be 0 or 1',
          weight: 100,
        });
      }
      if (read('checkpointsCompleted') > cfg.limits.maxCheckpointCount) {
        issues.push({
          code: 'teacher_checkpoints',
          message: 'checkpointsCompleted above the cap',
          weight: 100,
        });
      }
      if (cleared > 0 && read('checkpointsCompleted') < cfg.limits.minCheckpointCount) {
        issues.push({
          code: 'teacher_cleared_without_checkpoints',
          message: 'cleared with too few checkpoints collected',
          weight: 100,
        });
      }
      if (caught > cfg.limits.maxCaughtCount) {
        issues.push({ code: 'teacher_caught', message: 'caughtCount above the cap', weight: 60 });
      }
      if (detections > cfg.limits.maxDetectionCount) {
        issues.push({
          code: 'teacher_detections',
          message: 'detectionCount above the cap',
          weight: 60,
        });
      }
      // Every catch begins with being spotted, so one can never exceed the other.
      if (caught > detections) {
        issues.push({
          code: 'teacher_caught_without_detection',
          message: 'more catches than detections',
          weight: 100,
        });
      }
      if (timeRemaining > 0 && cleared < 1) {
        issues.push({
          code: 'teacher_time_without_clear',
          message: 'time bonus without reaching the exit',
          weight: 100,
        });
      }
      if (timeRemaining > cfg.limits.maxTimeRemainingSec) {
        issues.push({
          code: 'teacher_time_remaining',
          message: 'timeRemainingSec above the time limit',
          weight: 100,
        });
      }
      if (read('dangerPassCount') > cfg.scoring.maxDangerPassCount) {
        issues.push({
          code: 'teacher_danger_passes',
          message: 'dangerPassCount above the cap',
          weight: 40,
        });
      }
      if (read('perfectStealth') > 0 && (caught > 0 || detections > 0)) {
        issues.push({
          code: 'teacher_perfect_stealth_flag',
          message: 'perfectStealth reported alongside exposure',
          weight: 40,
        });
      }
      if (read('routeDistance') > cfg.limits.maxRouteDistancePx) {
        issues.push({
          code: 'teacher_route_distance',
          message: 'routeDistance above the cap',
          weight: 100,
        });
      }
      break;
    }
  }
  return issues;
}

/**
 * Checks that need the stage's duration as well as its metrics: a stealth run cannot
 * cover more ground than the player could physically walk, nor bank more remaining
 * time than the clock allows.
 */
function durationDependentIssues(
  stageId: StageId,
  metrics: Record<string, number>,
  durationMs: number,
): ValidationIssue[] {
  if (stageId !== 'teacher') return [];
  const cfg = RULES.stages.teacher;
  const issues: ValidationIssue[] = [];

  const timeRemaining = metrics.timeRemainingSec ?? 0;
  // +1 second of slack absorbs the client's flooring and one frame of drift.
  const possibleRemaining = Math.ceil(Math.max(0, cfg.timeLimitSec * 1000 - durationMs) / 1000) + 1;
  if (timeRemaining > possibleRemaining) {
    issues.push({
      code: 'teacher_time_impossible',
      message: `timeRemainingSec ${timeRemaining} is impossible in ${durationMs}ms`,
      weight: 100,
    });
  }

  // 15% headroom covers frame-rate jitter and the diagonal of a rounded path.
  const maxTravel = (durationMs / 1000) * cfg.limits.maxPlayerSpeedPxPerSec * 1.15 + 400;
  const routeDistance = metrics.routeDistance ?? 0;
  if (routeDistance > maxTravel) {
    issues.push({
      code: 'teacher_speed_hack',
      message: `routeDistance ${routeDistance} is impossible in ${durationMs}ms`,
      weight: 100,
    });
  }

  if ((metrics.idleTimeMs ?? 0) > durationMs) {
    issues.push({
      code: 'teacher_idle_time',
      message: 'idleTimeMs exceeds the stage duration',
      weight: 100,
    });
  }

  return issues;
}

export function validateSubmission(stages: readonly StageSubmission[]): ValidationOutcome {
  const issues: ValidationIssue[] = [];
  const stageScores: Record<string, number> = {};
  let totalScore = 0;
  let totalDuration = 0;

  if (stages.length === 0) {
    issues.push({ code: 'no_stages', message: 'submission contains no stages', weight: 100 });
  }

  const seen = new Set<string>();
  for (const stage of stages) {
    if (!isStageId(stage.stageId)) {
      issues.push({
        code: 'unknown_stage',
        message: `unknown stage ${stage.stageId}`,
        weight: 100,
      });
      continue;
    }
    if (seen.has(stage.stageId)) {
      issues.push({
        code: 'duplicate_stage',
        message: `stage ${stage.stageId} submitted twice`,
        weight: 100,
      });
      continue;
    }
    seen.add(stage.stageId);

    const limits = RULES.stages[stage.stageId].limits;
    const duration = Math.round(stage.durationMs);
    totalDuration += duration;

    if (!Number.isFinite(duration) || duration < limits.minDurationMs) {
      issues.push({
        code: 'duration_too_short',
        message: `${stage.stageId} finished impossibly fast (${duration}ms)`,
        weight: 100,
      });
    } else if (duration > limits.maxDurationMs) {
      issues.push({
        code: 'duration_too_long',
        message: `${stage.stageId} ran longer than possible (${duration}ms)`,
        weight: 100,
      });
    }

    issues.push(...metricIssues(stage.stageId, stage.metrics));
    issues.push(...durationDependentIssues(stage.stageId, stage.metrics, duration));

    const recomputed = computeStageScore(stage.stageId, stage.metrics);
    stageScores[stage.stageId] = recomputed;
    totalScore += recomputed;

    if (recomputed > maxPlausibleStageScore(stage.stageId)) {
      issues.push({
        code: 'impossible_score',
        message: `${stage.stageId} score exceeds the theoretical maximum`,
        weight: 100,
      });
    }
    // A mismatch is not automatically cheating (an old client, a rounding change),
    // so it raises suspicion rather than rejecting outright. The server's number wins.
    if (Math.abs(stage.score - recomputed) > 0) {
      issues.push({
        code: 'score_mismatch',
        message: `${stage.stageId}: client said ${stage.score}, server computed ${recomputed}`,
        weight: 25,
      });
    }
  }

  if (totalDuration < RULES.run.minTotalDurationMs && stages.length > 0) {
    issues.push({
      code: 'run_too_short',
      message: 'the whole run was impossibly short',
      weight: 100,
    });
  }
  if (totalDuration > RULES.run.maxTotalDurationMs) {
    issues.push({ code: 'run_too_long', message: 'the whole run took too long', weight: 40 });
  }

  const suspicionScore = Math.min(
    100,
    issues.reduce((sum, issue) => sum + issue.weight, 0),
  );

  return {
    valid: suspicionScore < REJECT_THRESHOLD,
    totalScore,
    stageScores,
    issues,
    suspicionScore,
  };
}
