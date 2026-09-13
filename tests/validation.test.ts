/**
 * Submission validation (the LOCAL MODE mirror of the PHP validator).
 *
 * The properties asserted here are the ones the leaderboard's integrity rests on, so
 * they are tested on both sides. The authoritative copy is
 * `backend/src/Validation/StageResultValidator.php`, covered by `RunApiTest`.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '@/config/rules';
import { computeStageScore } from '@/game/core/scoring';
import { REJECT_THRESHOLD, validateSubmission } from '@/services/run/validation';
import type { StageSubmission } from '@/services/api/types';

function stage(
  stageId: 'late' | 'bread' | 'teacher',
  metrics: Record<string, number>,
  durationMs: number,
): StageSubmission {
  return { stageId, metrics, durationMs, score: computeStageScore(stageId, metrics) };
}

function honestRun(): StageSubmission[] {
  return [
    stage(
      'late',
      {
        nearMissCount: 14,
        comboUnits: 18,
        collisionCount: 1,
        maxCombo: 5,
        goalReached: 1,
        timeRemainingSec: 6,
      },
      24_000,
    ),
    stage(
      'bread',
      {
        questionCount: 8,
        correctCount: 7,
        mistakeCount: 1,
        speedUnits: 30,
        comboUnits: 12,
        maxCombo: 5,
      },
      22_000,
    ),
    stage(
      'teacher',
      {
        cleared: 1,
        checkpointsCompleted: 3,
        timeRemainingSec: 41,
        caughtCount: 1,
        detectionCount: 2,
        dangerPassCount: 2,
        perfectStealth: 0,
        routeDistance: 9200,
        idleTimeMs: 4200,
      },
      49_000,
    ),
  ];
}

describe('validateSubmission', () => {
  it('accepts an honest run and reports the recomputed total', () => {
    const outcome = validateSubmission(honestRun());
    const expected = honestRun().reduce(
      (sum, entry) => sum + computeStageScore(entry.stageId, entry.metrics),
      0,
    );

    expect(outcome.valid).toBe(true);
    expect(outcome.issues).toEqual([]);
    expect(outcome.suspicionScore).toBe(0);
    expect(outcome.totalScore).toBe(expected);
  });

  it('ignores the claimed score and recomputes from metrics', () => {
    const stages = honestRun().map((entry) => ({ ...entry, score: 999_999 }));
    const outcome = validateSubmission(stages);

    expect(outcome.totalScore).toBeLessThan(30_000);
    expect(outcome.issues.some((issue) => issue.code === 'score_mismatch')).toBe(true);
    // Three mismatches at weight 25 each cross the rejection threshold.
    expect(outcome.valid).toBe(false);
  });

  it('rejects an empty submission', () => {
    const outcome = validateSubmission([]);

    expect(outcome.valid).toBe(false);
    expect(outcome.issues.map((issue) => issue.code)).toContain('no_stages');
  });

  it('rejects a duplicated stage', () => {
    const stages = honestRun();
    const outcome = validateSubmission([...stages, stages[0]!]);

    expect(outcome.issues.map((issue) => issue.code)).toContain('duplicate_stage');
    expect(outcome.valid).toBe(false);
  });

  it('rejects an unknown stage id', () => {
    const outcome = validateSubmission([
      { stageId: 'hacked' as 'late', score: 0, durationMs: 20_000, metrics: {} },
    ]);

    expect(outcome.issues.map((issue) => issue.code)).toContain('unknown_stage');
  });

  it('rejects a stage that finished impossibly fast', () => {
    const stages = honestRun();
    stages[0] = { ...stages[0]!, durationMs: 10 };

    expect(validateSubmission(stages).issues.map((i) => i.code)).toContain('duration_too_short');
  });

  it('rejects a stage that ran longer than possible', () => {
    const stages = honestRun();
    stages[0] = { ...stages[0]!, durationMs: 10_000_000 };

    expect(validateSubmission(stages).issues.map((i) => i.code)).toContain('duration_too_long');
  });

  it('rejects negative and non-finite metrics', () => {
    expect(
      validateSubmission([stage('late', { nearMissCount: -5 }, 20_000)]).issues.map((i) => i.code),
    ).toContain('metric_negative');

    expect(
      validateSubmission([
        { stageId: 'late', score: 0, durationMs: 20_000, metrics: { nearMissCount: NaN } },
      ]).issues.map((i) => i.code),
    ).toContain('metric_not_finite');
  });

  it('caps near misses at what the stage can physically produce', () => {
    const stages = honestRun();
    stages[0] = stage(
      'late',
      { ...stages[0]!.metrics, nearMissCount: RULES.stages.late.limits.maxNearMissCount + 1 },
      24_000,
    );

    expect(validateSubmission(stages).issues.map((i) => i.code)).toContain('late_near_miss');
  });

  it('caps combo units by the number of scoring hits that produced them', () => {
    expect(
      validateSubmission([stage('late', { nearMissCount: 2, comboUnits: 999 }, 20_000)]).issues.map(
        (i) => i.code,
      ),
    ).toContain('late_combo_units');

    expect(
      validateSubmission([
        stage('bread', { questionCount: 8, correctCount: 2, comboUnits: 999 }, 20_000),
      ]).issues.map((i) => i.code),
    ).toContain('bread_combo_units');
  });

  it('caps speed units by the number of correct answers', () => {
    expect(
      validateSubmission([
        stage('bread', { questionCount: 8, correctCount: 1, speedUnits: 500 }, 20_000),
      ]).issues.map((i) => i.code),
    ).toContain('bread_speed_units');
  });

  it('rejects a time bonus without reaching the gate', () => {
    expect(
      validateSubmission([
        stage('late', { goalReached: 0, timeRemainingSec: 20 }, 24_000),
      ]).issues.map((i) => i.code),
    ).toContain('late_time_without_goal');
  });

  describe('stage 3 - the stealth run', () => {
    const codes = (metrics: Record<string, number>, durationMs = 40_000): string[] =>
      validateSubmission([stage('teacher', metrics, durationMs)]).issues.map((i) => i.code);

    it('rejects a clear that never collected the objectives', () => {
      expect(codes({ cleared: 1, checkpointsCompleted: 0, timeRemainingSec: 20 })).toContain(
        'teacher_cleared_without_checkpoints',
      );
    });

    it('rejects a time bonus without an escape', () => {
      expect(codes({ cleared: 0, timeRemainingSec: 40 })).toContain('teacher_time_without_clear');
    });

    it('rejects banking more time than the clock could possibly have left', () => {
      // 40s of play out of a 90s limit leaves 50s, not 85.
      expect(codes({ cleared: 1, checkpointsCompleted: 3, timeRemainingSec: 85 })).toContain(
        'teacher_time_impossible',
      );
      expect(codes({ cleared: 1, checkpointsCompleted: 3, timeRemainingSec: 49 })).not.toContain(
        'teacher_time_impossible',
      );
    });

    it('rejects a distance no one could have walked in the time reported', () => {
      // 40 seconds at the maximum plausible pace is nowhere near 60km of corridor.
      expect(codes({ cleared: 0, routeDistance: 59_000 })).toContain('teacher_speed_hack');
      expect(codes({ cleared: 0, routeDistance: 9_000 })).not.toContain('teacher_speed_hack');
    });

    it('rejects more catches than sightings, which cannot happen', () => {
      expect(codes({ caughtCount: 4, detectionCount: 1 })).toContain(
        'teacher_caught_without_detection',
      );
    });

    it('rejects standing still for longer than the stage lasted', () => {
      expect(codes({ idleTimeMs: 80_000 }, 40_000)).toContain('teacher_idle_time');
    });

    it('flags a perfect-stealth claim that the exposure counters contradict', () => {
      expect(codes({ perfectStealth: 1, detectionCount: 3, caughtCount: 1 })).toContain(
        'teacher_perfect_stealth_flag',
      );
    });

    it('gives the forged flag no score anyway, because the bonus is derived', () => {
      const honest = {
        cleared: 1,
        checkpointsCompleted: 3,
        timeRemainingSec: 45,
        caughtCount: 1,
        detectionCount: 2,
      };

      expect(computeStageScore('teacher', { ...honest, perfectStealth: 1 })).toBe(
        computeStageScore('teacher', { ...honest, perfectStealth: 0 }),
      );
    });
  });

  it('rejects a question count outside the configured range', () => {
    expect(
      validateSubmission([
        stage('bread', { questionCount: 99, correctCount: 1 }, 20_000),
      ]).issues.map((i) => i.code),
    ).toContain('bread_questions');
  });

  it('rejects a run that is far too short overall', () => {
    const outcome = validateSubmission([
      stage('late', { nearMissCount: 1 }, RULES.stages.late.limits.minDurationMs),
    ]);

    expect(outcome.issues.map((i) => i.code)).toContain('run_too_short');
  });

  it('caps the suspicion score at 100', () => {
    const outcome = validateSubmission([
      stage('late', { nearMissCount: -1, comboUnits: 99_999, timeRemainingSec: 99_999 }, 5),
    ]);

    expect(outcome.suspicionScore).toBe(100);
    expect(outcome.suspicionScore).toBeGreaterThanOrEqual(REJECT_THRESHOLD);
  });

  it('tolerates a single low-weight oddity without rejecting an honest player', () => {
    const stages = honestRun();
    // One stale-client score mismatch weighs 25, below the rejection threshold.
    stages[0] = { ...stages[0]!, score: stages[0]!.score + 1 };
    const outcome = validateSubmission(stages);

    expect(outcome.suspicionScore).toBeLessThan(REJECT_THRESHOLD);
    expect(outcome.valid).toBe(true);
  });
});
