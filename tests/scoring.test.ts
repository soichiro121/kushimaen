/**
 * The frontend half of the frontend/backend agreement test.
 *
 * It asserts the SAME golden vectors as `backend/tests/ScoreCalculatorTest.php`.
 * Changing a formula on one side alone turns the other side red, which is the whole
 * mechanism that stops the score on screen drifting from the score on the leaderboard.
 */
import { describe, expect, it } from 'vitest';
import fixtures from '@shared/game-rules/score-fixtures.json';
import { RULES, type StageId } from '@/config/rules';
import {
  comboUnitsForHit,
  computeStageScore,
  computeStageScoreRaw,
  maxPlausibleStageScore,
  speedUnitsForReaction,
} from '@/game/core/scoring';

describe('shared golden vectors', () => {
  it('uses the same rule-set version as the fixtures', () => {
    expect(fixtures.configVersion).toBe(RULES.configVersion);
  });

  it.each(fixtures.stageScores.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    // The fixture file has a different metric set per stage, so TypeScript infers a
    // union with optional keys; the runtime shape is always a flat numeric map.
    const metrics = fixture.metrics as unknown as Record<string, number>;
    expect(computeStageScore(fixture.stageId as StageId, metrics)).toBe(fixture.expected);
  });

  it.each(fixtures.comboUnits)(
    'combo level $comboLevel awards $expected units',
    ({ comboLevel, maxUnitsPerHit, expected }) => {
      expect(comboUnitsForHit(comboLevel, maxUnitsPerHit)).toBe(expected);
    },
  );

  it.each(fixtures.speedUnits)(
    'a $reactionMs ms answer awards $expected speed units',
    ({ reactionMs, expected }) => {
      expect(speedUnitsForReaction(reactionMs)).toBe(expected);
    },
  );
});

describe('score clamping', () => {
  it('never reports a negative score', () => {
    expect(computeStageScore('late', { collisionCount: 99 })).toBe(0);
    expect(computeStageScore('bread', { mistakeCount: 99 })).toBe(0);
    expect(computeStageScore('teacher', { caughtCount: 99 })).toBe(0);
  });

  it('keeps the negative tail in the raw score so penalties can still be shown', () => {
    // Without this the popup would read "+0" while the player keeps losing points.
    expect(computeStageScoreRaw('late', { collisionCount: 2 })).toBeLessThan(0);
  });

  it('ignores unknown metrics and treats missing ones as zero', () => {
    expect(computeStageScore('late', { nearMissCount: 1, somethingElse: 10_000 })).toBe(
      RULES.stages.late.scoring.nearMissScore,
    );
  });

  it('rejects an unregistered stage rather than scoring it as zero', () => {
    expect(() => computeStageScore('nope' as StageId, {})).toThrow();
  });
});

describe('bread run-length normalisation', () => {
  /**
   * The number of orders is random, so without normalisation the leaderboard would
   * reward the luck of drawing a long run. Identical per-order play must score the
   * same whatever the length.
   */
  it('scores identical per-order play the same at every run length', () => {
    const perOrder = { speedUnits: 7, comboUnits: 4 };
    const scores = new Set<number>();

    for (
      let questions = RULES.stages.bread.minQuestions;
      questions <= RULES.stages.bread.maxQuestions;
      questions++
    ) {
      scores.add(
        computeStageScore('bread', {
          questionCount: questions,
          correctCount: questions,
          mistakeCount: 0,
          speedUnits: perOrder.speedUnits * questions,
          comboUnits: perOrder.comboUnits * questions,
        }),
      );
    }

    expect(scores.size).toBe(1);
  });

  it('still rewards answering more of the orders correctly', () => {
    const base = { questionCount: 10, speedUnits: 30, comboUnits: 10, mistakeCount: 0 };

    expect(computeStageScore('bread', { ...base, correctCount: 10 })).toBeGreaterThan(
      computeStageScore('bread', { ...base, correctCount: 6 }),
    );
  });

  it('clamps an out-of-range question count instead of dividing by zero', () => {
    expect(Number.isFinite(computeStageScore('bread', { questionCount: 0, correctCount: 1 }))).toBe(
      true,
    );
    expect(Number.isFinite(computeStageScore('bread', { correctCount: 1 }))).toBe(true);
  });
});

describe('theoretical maxima', () => {
  it.each(RULES.stageOrder)('%s has a positive upper bound', (stageId) => {
    expect(maxPlausibleStageScore(stageId)).toBeGreaterThan(0);
  });

  it('bounds every rank threshold below the theoretical maximum', () => {
    // An unreachable S rank would be a balance bug, not a challenge.
    for (const stageId of RULES.stageOrder) {
      expect(RULES.stages[stageId].rank.S).toBeLessThan(maxPlausibleStageScore(stageId));
    }
  });
});
