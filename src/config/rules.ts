/**
 * Typed access to the shared, versioned rule set.
 *
 * The raw JSON in `shared/game-rules/` is the single source of truth and is read by
 * the PHP backend as well. Bump the version (a new `vN.json` plus `CONFIG_VERSION`
 * in `backend/.env`) whenever a change would move existing scores, so the two
 * generations stay distinguishable on the leaderboard. Nothing in this file may introduce a number that the
 * backend cannot see — if a value influences a score, it belongs in the JSON.
 */
import currentRules from '@shared/game-rules/v3.json';

export type StageId = 'late' | 'bread' | 'teacher';

export interface RankThresholds {
  S: number;
  A: number;
  B: number;
  C: number;
}

export interface LateRules {
  timeLimitSec: number;
  scoring: {
    nearMissScore: number;
    comboUnitScore: number;
    maxComboUnitsPerHit: number;
    collisionPenalty: number;
    goalBonus: number;
    timeBonusPerSecond: number;
  };
  limits: {
    minDurationMs: number;
    maxDurationMs: number;
    maxNearMissCount: number;
    maxCollisionCount: number;
    maxTimeRemainingSec: number;
  };
  rank: RankThresholds;
}

export interface BreadRules {
  minQuestions: number;
  maxQuestions: number;
  /** Run length the score is normalised to, so a 6-order run is worth a 10-order run. */
  referenceQuestions: number;
  speedWindowMs: number;
  speedStepMs: number;
  maxSpeedUnitsPerQuestion: number;
  scoring: {
    correctScore: number;
    speedUnitScore: number;
    comboUnitScore: number;
    maxComboUnitsPerHit: number;
    mistakePenalty: number;
  };
  limits: {
    minDurationMs: number;
    maxDurationMs: number;
    maxMistakeCount: number;
  };
  rank: RankThresholds;
}

export interface TeacherRules {
  /** Hard stop for the stealth run. Going over it ends the stage un-cleared. */
  timeLimitSec: number;
  scoring: {
    clearBonus: number;
    checkpointScore: number;
    /** Seconds of remaining time that earn nothing, so the bonus rewards speed
     *  rather than the generous safety limit the stage is capped at. */
    timeBonusFreeSec: number;
    timeBonusPerSecond: number;
    /** Awarded on a clear with zero catches. */
    noCaughtBonus: number;
    /** Awarded on top of that when no teacher ever reached alert level. */
    perfectStealthBonus: number;
    dangerBonus: number;
    /** Hard cap on payable danger passes, so the bonus can never be farmed. */
    maxDangerPassCount: number;
    caughtPenalty: number;
  };
  limits: {
    minDurationMs: number;
    maxDurationMs: number;
    maxCheckpointCount: number;
    /** Fewest checkpoints a genuine clear can possibly involve (objective + exit). */
    minCheckpointCount: number;
    maxCaughtCount: number;
    maxDetectionCount: number;
    maxTimeRemainingSec: number;
    /** Used to reject an impossible `routeDistance` for the reported duration. */
    maxPlayerSpeedPxPerSec: number;
    maxRouteDistancePx: number;
  };
  rank: RankThresholds;
}

export interface RuleSet {
  configVersion: number;
  title: string;
  subtitle: string;
  stageOrder: StageId[];
  run: {
    ttlSeconds: number;
    minTotalDurationMs: number;
    maxTotalDurationMs: number;
  };
  nickname: {
    minLength: number;
    maxLength: number;
  };
  stages: {
    late: LateRules;
    bread: BreadRules;
    teacher: TeacherRules;
  };
}

export const RULES: RuleSet = currentRules as RuleSet;

export const CONFIG_VERSION = RULES.configVersion;

/** Rank thresholds are inclusive lower bounds, checked from best to worst. */
export type Rank = 'S' | 'A' | 'B' | 'C';

const RANK_ORDER: Rank[] = ['S', 'A', 'B', 'C'];

export function rankForStage(stageId: StageId, score: number): Rank {
  const thresholds = RULES.stages[stageId].rank;
  for (const rank of RANK_ORDER) {
    if (score >= thresholds[rank]) return rank;
  }
  return 'C';
}

/** Total-run rank uses the sum of the per-stage S/A/B thresholds. */
export function rankForTotal(total: number): Rank {
  const stageIds = RULES.stageOrder;
  const sum = (rank: Rank): number =>
    stageIds.reduce((acc, id) => acc + RULES.stages[id].rank[rank], 0);
  if (total >= sum('S')) return 'S';
  if (total >= sum('A')) return 'A';
  if (total >= sum('B')) return 'B';
  return 'C';
}
