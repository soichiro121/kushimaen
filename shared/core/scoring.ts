/**
 * Pure score formulas.
 *
 * ONE implementation, used in TWO places: the game draws the number on screen with
 * it, and `completeRun` in the API recomputes every submitted score with it. There is
 * no second copy to drift. The golden fixtures in
 * `shared/game-rules/score-fixtures.json` pin the formulas themselves.
 *
 * Invariants:
 *  - Every function is pure and integer-valued.
 *  - A stage score depends ONLY on (metrics, rules). No timing, no randomness,
 *    no object references. This is what makes server-side recomputation exact.
 *
 * Clamped vs raw:
 *  - `computeStageScore` is the real score and never goes below zero.
 *  - `computeStageScoreRaw` keeps the negative tail. It exists only so that a
 *    popup can say "-500" while the player is sitting on a clamped zero; if the
 *    popup were derived from the clamped value it would read "+0" and the player
 *    would have no idea their mistakes were costing anything.
 */
import { RULES, type StageId } from './rules';

/** Metrics travel over the wire as a flat numeric map - trivially serialisable. */
export type StageMetrics = Readonly<Record<string, number>>;

function read(metrics: StageMetrics, key: string): number {
  const value = metrics[key];
  return Number.isFinite(value) ? (value as number) : 0;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Combo units awarded for a single successful action at 1-indexed combo level.
 * Level 1 (the first hit of a chain) awards nothing; the chain has to be built.
 */
export function comboUnitsForHit(comboLevel: number, maxUnitsPerHit: number): number {
  if (comboLevel <= 1) return 0;
  return clamp(Math.floor(comboLevel) - 1, 0, maxUnitsPerHit);
}

/** Speed units awarded for one correct bread answer. Faster answer -> more units. */
export function speedUnitsForReaction(reactionMs: number): number {
  const { speedWindowMs, speedStepMs, maxSpeedUnitsPerQuestion } = RULES.stages.bread;
  if (reactionMs >= speedWindowMs) return 0;
  const units = Math.ceil((speedWindowMs - reactionMs) / speedStepMs);
  return clamp(units, 0, maxSpeedUnitsPerQuestion);
}

// ---------------------------------------------------------------------------
// Raw (unclamped) formulas - one per stage
// ---------------------------------------------------------------------------

function lateRaw(metrics: StageMetrics): number {
  const cfg = RULES.stages.late.scoring;
  const nearMiss = read(metrics, 'nearMissCount') * cfg.nearMissScore;
  const combo = read(metrics, 'comboUnits') * cfg.comboUnitScore;
  const collision = read(metrics, 'collisionCount') * cfg.collisionPenalty;
  const goal =
    read(metrics, 'goalReached') > 0
      ? cfg.goalBonus + read(metrics, 'timeRemainingSec') * cfg.timeBonusPerSecond
      : 0;
  return nearMiss + combo + goal - collision;
}

/**
 * The number of orders in a run is random (6-10), and every term of the bread score
 * scales with it - so without normalisation a player who happened to draw 10 orders
 * scored roughly 1.9x one who drew 6, for no reason they controlled. On a shared
 * leaderboard that is pure luck, so the score is scaled to a fixed reference length.
 *
 * `questionCount` is a submitted metric, so this stays exactly recomputable by the
 * server. It is clamped to the configured range first, which keeps the function
 * total even for a malformed submission (the validator rejects those separately).
 */
export function breadQuestionNormalisation(questionCount: number): number {
  const { minQuestions, maxQuestions, referenceQuestions } = RULES.stages.bread;
  const questions = clamp(Math.round(questionCount) || minQuestions, minQuestions, maxQuestions);
  return referenceQuestions / questions;
}

function breadRaw(metrics: StageMetrics): number {
  const cfg = RULES.stages.bread.scoring;
  const earned =
    read(metrics, 'correctCount') * cfg.correctScore +
    read(metrics, 'speedUnits') * cfg.speedUnitScore +
    read(metrics, 'comboUnits') * cfg.comboUnitScore -
    read(metrics, 'mistakeCount') * cfg.mistakePenalty;

  return earned * breadQuestionNormalisation(read(metrics, 'questionCount'));
}

/**
 * STAGE 3 - the stealth run.
 *
 * Time is the spine of the score: `timeBonusPerSecond` is by far the largest term,
 * which is what stops "hide in a safe corner until the teacher leaves" from being
 * the optimal strategy (requirement 33). Waiting is always allowed and always
 * expensive.
 *
 * Perfect stealth is DERIVED from the exposure metrics rather than read from a
 * `perfectStealth` flag. The flag is still submitted for the result screen, but a
 * forged one cannot buy the bonus, because the server computes this from the same
 * counters it independently bounds.
 */
/**
 * The most time a legal run can possibly have left on the clock.
 *
 * Even a perfect escape takes `minDurationMs`, so the raw time limit is not the
 * ceiling. Both the formula and its upper bound clamp to this, which is what stops a
 * submitted `timeRemainingSec` of 90 scoring more than the stage's own maximum.
 */
export function teacherBestRemainingSec(): number {
  const { limits, timeLimitSec } = RULES.stages.teacher;
  return Math.max(
    0,
    Math.min(limits.maxTimeRemainingSec, timeLimitSec - Math.ceil(limits.minDurationMs / 1000)),
  );
}

function teacherRaw(metrics: StageMetrics): number {
  const cfg = RULES.stages.teacher.scoring;
  const limits = RULES.stages.teacher.limits;

  const cleared = read(metrics, 'cleared') > 0;
  const caught = read(metrics, 'caughtCount');
  const detections = read(metrics, 'detectionCount');

  const checkpoints = clamp(read(metrics, 'checkpointsCompleted'), 0, limits.maxCheckpointCount);
  const dangerPasses = clamp(read(metrics, 'dangerPassCount'), 0, cfg.maxDangerPassCount);
  // Only time saved beyond the free allowance scores. The stage's 90-second limit is
  // a safety net, not a target, and paying for every second under it would hand a
  // huge identical bonus to everyone who simply finished.
  const timeRemaining = cleared
    ? Math.max(
        0,
        clamp(read(metrics, 'timeRemainingSec'), 0, teacherBestRemainingSec()) -
          cfg.timeBonusFreeSec,
      )
    : 0;

  let total = checkpoints * cfg.checkpointScore + dangerPasses * cfg.dangerBonus;
  if (cleared) {
    total += cfg.clearBonus + timeRemaining * cfg.timeBonusPerSecond;
    if (caught <= 0) total += cfg.noCaughtBonus;
    if (caught <= 0 && detections <= 0) total += cfg.perfectStealthBonus;
  }
  return total - caught * cfg.caughtPenalty;
}

/**
 * The bonus the result screen shows as PERFECT STEALTH. Derived, never trusted from
 * the client - see `teacherRaw`.
 */
export function isPerfectStealth(metrics: StageMetrics): boolean {
  return read(metrics, 'caughtCount') <= 0 && read(metrics, 'detectionCount') <= 0;
}

const RAW_CALCULATORS: Record<StageId, (metrics: StageMetrics) => number> = {
  late: lateRaw,
  bread: breadRaw,
  teacher: teacherRaw,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeLateScore(metrics: StageMetrics): number {
  return Math.max(0, Math.round(lateRaw(metrics)));
}

export function computeBreadScore(metrics: StageMetrics): number {
  return Math.max(0, Math.round(breadRaw(metrics)));
}

export function computeTeacherScore(metrics: StageMetrics): number {
  return Math.max(0, Math.round(teacherRaw(metrics)));
}

/** Score before the zero clamp. Display-only - never stored or submitted. */
export function computeStageScoreRaw(stageId: StageId, metrics: StageMetrics): number {
  const calculator = RAW_CALCULATORS[stageId];
  if (!calculator) {
    throw new Error(`No score calculator registered for stage "${stageId}"`);
  }
  return Math.round(calculator(metrics));
}

/** The authoritative stage score. */
export function computeStageScore(stageId: StageId, metrics: StageMetrics): number {
  return Math.max(0, computeStageScoreRaw(stageId, metrics));
}

/**
 * Upper bound used for the "impossible score" sanity check. The backend applies the
 * authoritative version of this; the frontend uses it only to avoid submitting
 * garbage after a bug.
 */
export function maxPlausibleStageScore(stageId: StageId): number {
  const stage = RULES.stages;
  switch (stageId) {
    case 'late': {
      const { scoring, limits } = stage.late;
      return (
        limits.maxNearMissCount * scoring.nearMissScore +
        limits.maxNearMissCount * scoring.maxComboUnitsPerHit * scoring.comboUnitScore +
        scoring.goalBonus +
        limits.maxTimeRemainingSec * scoring.timeBonusPerSecond
      );
    }
    case 'bread': {
      const { scoring, minQuestions, maxQuestions, maxSpeedUnitsPerQuestion } = stage.bread;
      // The shortest run has the largest normalisation factor, so that is the bound.
      const perfect =
        maxQuestions * scoring.correctScore +
        maxQuestions * maxSpeedUnitsPerQuestion * scoring.speedUnitScore +
        maxQuestions * scoring.maxComboUnitsPerHit * scoring.comboUnitScore;
      return Math.ceil(perfect * breadQuestionNormalisation(minQuestions));
    }
    case 'teacher': {
      const { scoring, limits } = stage.teacher;
      const bestRemaining = teacherBestRemainingSec();
      return (
        scoring.clearBonus +
        limits.maxCheckpointCount * scoring.checkpointScore +
        Math.max(0, bestRemaining - scoring.timeBonusFreeSec) * scoring.timeBonusPerSecond +
        scoring.noCaughtBonus +
        scoring.perfectStealthBonus +
        scoring.maxDangerPassCount * scoring.dangerBonus
      );
    }
  }
}
