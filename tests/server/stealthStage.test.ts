// @vitest-environment node
/**
 * Stage 3 (the stealth run) anti-cheat, through the real HTTP stack.
 *
 * This stage has no per-action counters to bound the way the other two do - there is
 * no "taps per second" to cap. Its integrity rests on internal consistency instead:
 * a clear implies reaching the exit, a time bonus implies a clear, the distance
 * walked has to fit in the time reported, and the bonuses have to agree with the
 * exposure counters. Each of those is asserted here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES } from '@shared/core/rules';
import { computeStageScore, maxPlausibleStageScore } from '@shared/core/scoring';
import { createTestApi, json, stagesWith, type TestApi } from './support/api';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

beforeEach(async () => {
  await api.reset();
  // Rejections are logged on purpose; the assertions are about the responses.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await api.close();
});

/** Submits an otherwise-honest run whose stage-3 metrics carry `overrides`. */
async function submitTeacher(
  overrides: Record<string, number>,
  durationMs?: number,
): Promise<{ accepted: boolean; stageScores: Record<string, number> }> {
  const runId = await api.openRun();
  return json(
    await api.completeRun(runId, {
      nickname: 'ステルス',
      stages: stagesWith('teacher', overrides, durationMs),
      totalScore: 0,
    }),
  );
}

describe('stage 3 submissions', () => {
  it('accepts an honest stealth run', async () => {
    const body = await submitTeacher({});

    expect(body.accepted).toBe(true);
    expect(body.stageScores.teacher).toBeGreaterThan(0);
  });

  it('rejects clearing without collecting the objectives', async () => {
    expect((await submitTeacher({ cleared: 1, checkpointsCompleted: 0 })).accepted).toBe(false);
  });

  it('rejects a time bonus without an escape', async () => {
    expect((await submitTeacher({ cleared: 0, timeRemainingSec: 50 })).accepted).toBe(false);
  });

  it('rejects banking more time than the clock could have left', async () => {
    // 49 seconds of play out of a 90-second limit leaves about 41, not 80.
    expect((await submitTeacher({ timeRemainingSec: 80 })).accepted).toBe(false);
  });

  it('rejects walking further than is physically possible', async () => {
    expect((await submitTeacher({ routeDistance: 55_000 })).accepted).toBe(false);
  });

  it('rejects more catches than sightings', async () => {
    // Every catch begins with being spotted, so this cannot occur.
    expect((await submitTeacher({ caughtCount: 4, detectionCount: 1 })).accepted).toBe(false);
  });

  it('rejects standing still for longer than the stage lasted', async () => {
    expect((await submitTeacher({ idleTimeMs: 120_000 })).accepted).toBe(false);
  });

  it('rejects a negative metric', async () => {
    expect((await submitTeacher({ caughtCount: -5 })).accepted).toBe(false);
  });
});

describe('stage 3 scoring', () => {
  /**
   * The headline property: `perfectStealth` is submitted for the result screen, but
   * the bonus is DERIVED from the exposure counters, so forging the flag is worth
   * exactly nothing.
   */
  it('gives a forged perfectStealth flag no score at all', () => {
    const honest = {
      cleared: 1,
      checkpointsCompleted: 3,
      timeRemainingSec: 45,
      caughtCount: 1,
      detectionCount: 2,
      dangerPassCount: 1,
      routeDistance: 9200,
      idleTimeMs: 4200,
    };

    expect(computeStageScore('teacher', { ...honest, perfectStealth: 1 })).toBe(
      computeStageScore('teacher', { ...honest, perfectStealth: 0 }),
    );
  });

  /** Requirement 32: the danger bonus must not be farmable, in the formula itself. */
  it('caps danger passes', () => {
    const cap = RULES.stages.teacher.scoring.maxDangerPassCount;

    expect(computeStageScore('teacher', { dangerPassCount: cap })).toBe(
      computeStageScore('teacher', { dangerPassCount: 99_999 }),
    );
  });

  it('pays only for time saved beyond the free allowance', () => {
    const free = RULES.stages.teacher.scoring.timeBonusFreeSec;
    const base = { cleared: 1, checkpointsCompleted: 3, caughtCount: 0, detectionCount: 0 };

    // Anything inside the allowance is worth the same: finishing is not speed.
    expect(computeStageScore('teacher', { ...base, timeRemainingSec: 0 })).toBe(
      computeStageScore('teacher', { ...base, timeRemainingSec: free }),
    );
    expect(computeStageScore('teacher', { ...base, timeRemainingSec: free + 10 })).toBeGreaterThan(
      computeStageScore('teacher', { ...base, timeRemainingSec: free }),
    );
  });

  it('cannot be pushed past its own theoretical maximum', () => {
    // Every metric at its ceiling at once still lands under the bound the validator
    // checks against, so the bound and the formula have not drifted apart.
    const ceiling = computeStageScore('teacher', {
      cleared: 1,
      checkpointsCompleted: 999,
      timeRemainingSec: 999,
      dangerPassCount: 999,
      caughtCount: 0,
      detectionCount: 0,
    });

    expect(ceiling).toBeLessThanOrEqual(maxPlausibleStageScore('teacher'));
  });
});
