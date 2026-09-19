// @vitest-environment node
/**
 * Ranking, period filtering and the caller's own placement.
 *
 * Run against a real PostgreSQL, because every property here IS the SQL: the
 * ordering, the tie-break, the day boundary and the config-version filter.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RULES } from '@shared/core/rules';
import { computeStageScore } from '@shared/core/scoring';
import { createTestApi, json, validStages, type TestApi } from './support/api';
import type { LeaderboardResponse } from '@shared/core/api';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

beforeEach(async () => {
  await api.reset();
});

afterAll(async () => {
  await api.close();
});

/** Plays a full run at a chosen strength and returns its id. */
async function submitRun(nickname: string, nearMissCount: number): Promise<string> {
  const runId = await api.openRun();
  const stages = validStages();

  const late = stages[0]!;
  const metrics = {
    ...late.metrics,
    nearMissCount,
    // Read the cap from the rule set rather than hard-coding it: combo units are
    // bounded by the hits that produced them, and a literal here would silently
    // invalidate this fixture the next time the balance is tuned.
    comboUnits: Math.min(
      late.metrics.comboUnits ?? 0,
      nearMissCount * RULES.stages.late.scoring.maxComboUnitsPerHit,
    ),
  };
  stages[0] = { ...late, metrics, score: computeStageScore('late', metrics) };

  const body = await json<{ accepted: boolean }>(
    await api.completeRun(runId, { nickname, stages, totalScore: 0 }),
  );
  expect(body.accepted, 'fixture submission was rejected').toBe(true);

  return runId;
}

async function board(query: string): Promise<LeaderboardResponse> {
  return json<LeaderboardResponse>(await api.leaderboard(query));
}

describe('GET /api/leaderboard', () => {
  it('orders entries by score, highest first', async () => {
    await submitRun('ひくい', 2);
    await submitRun('たかい', 40);
    await submitRun('まんなか', 20);

    const result = await board('?period=all');

    expect(result.entries.map((entry) => entry.nickname)).toEqual(['たかい', 'まんなか', 'ひくい']);
    expect(result.entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(result.total).toBe(3);
  });

  it('breaks a tie in favour of the earlier submission', async () => {
    await submitRun('さきに', 10);
    api.clock.advanceSeconds(60);
    await submitRun('あとから', 10);

    const result = await board('?period=all');

    expect(result.entries[0]?.nickname).toBe('さきに');
    expect(result.entries[1]?.nickname).toBe('あとから');
  });

  it('keeps yesterday off the daily board but on the all-time one', async () => {
    await submitRun('きのう', 30);
    api.clock.advanceSeconds(2 * 24 * 60 * 60);
    await submitRun('きょう', 5);

    expect((await board('?period=today')).entries.map((e) => e.nickname)).toEqual(['きょう']);
    expect((await board('?period=all')).entries.map((e) => e.nickname)).toEqual([
      'きのう',
      'きょう',
    ]);
  });

  it('returns the caller their own placement even when it is off the page', async () => {
    const mine = await submitRun('わたし', 2);
    for (let i = 0; i < 4; i++) await submitRun(`つよい${i}`, 30 + i);

    const result = await board(`?period=all&limit=2&runId=${mine}`);

    expect(result.entries).toHaveLength(2);
    expect(result.me?.nickname).toBe('わたし');
    expect(result.me?.rank).toBe(5);
  });

  it('flags the caller their own row when it is on the page', async () => {
    const mine = await submitRun('わたし', 40);
    await submitRun('ほか', 2);

    const result = await board(`?period=all&runId=${mine}`);

    expect(result.entries[0]?.isMe).toBe(true);
    expect(result.entries[1]?.isMe).toBe(false);
  });

  it('never shows a rejected entry', async () => {
    await submitRun('しょうじき', 10);

    // A submission whose metrics do not support its claimed score.
    const runId = await api.openRun();
    const stages = validStages().map((stage) => ({ ...stage, score: 999_999 }));
    await api.completeRun(runId, { nickname: 'ずる', stages, totalScore: 999_999 });

    const result = await board('?period=all');

    expect(result.entries.map((entry) => entry.nickname)).toEqual(['しょうじき']);
    expect(result.total).toBe(1);
  });

  /**
   * Scores from a different balance version are not comparable, so they must not
   * share a ranking. Without this the first rebalance would leave old, inflated
   * totals permanently on top of the board.
   */
  it('does not rank a score played under an older rule set', async () => {
    await submitRun('いま', 10);

    // A score from the previous balance, with a total nobody can reach today.
    await api.db.query(
      `INSERT INTO runs (id, seed, config_version, started_at, expires_at, completed_at, status)
       VALUES ($1, 1, $2, $3, $3, $3, 'completed')`,
      ['00000000-0000-4000-8000-0000000001d0', RULES.configVersion - 1, api.clock.now()],
    );
    await api.db.query(
      `INSERT INTO scores (run_id, nickname, total_score, created_at, valid, suspicion_score, config_version)
       VALUES ($1, 'むかし', 999999, $2, 1, 0, $3)`,
      ['00000000-0000-4000-8000-0000000001d0', api.clock.now(), RULES.configVersion - 1],
    );

    const result = await board('?period=all');

    expect(result.entries.map((entry) => entry.nickname)).toEqual(['いま']);
    expect(result.total).toBe(1);
  });

  it('answers an empty board with an empty list, not an error', async () => {
    const response = await api.leaderboard('?period=today');
    const result = await json<LeaderboardResponse>(response);

    expect(response.status).toBe(200);
    expect(result.entries).toEqual([]);
    expect(result.me).toBeNull();
    expect(result.total).toBe(0);
  });

  it('clamps the limit so a client cannot ask for the whole table', async () => {
    await submitRun('ひとり', 10);

    const result = await board('?period=all&limit=100000');

    expect(result.entries.length).toBeLessThanOrEqual(100);
  });

  it('treats an unknown period as all-time rather than trusting it', async () => {
    await submitRun('だれか', 10);

    const result = await board(`?period=${encodeURIComponent("' OR 1=1--")}`);

    expect(result.period).toBe('all');
    expect(result.entries).toHaveLength(1);
  });

  it('ignores a malformed runId instead of querying with it', async () => {
    await submitRun('だれか', 10);

    const result = await board(`?period=all&runId=${encodeURIComponent("' OR 1=1--")}`);

    expect(result.me).toBeNull();
    expect(result.entries[0]?.isMe).toBe(false);
  });
});

/**
 * A submission with chosen metrics per stage, each stage's claimed score recomputed
 * so the whole thing is accepted. Lets one player be excellent at one mini-game and
 * mediocre at the rest, which is the only way to tell a stage board apart from a
 * slice of the combined one.
 */
async function submitStages(
  nickname: string,
  overrides: Partial<Record<'late' | 'bread' | 'teacher', Record<string, number>>>,
): Promise<string> {
  const runId = await api.openRun();

  const stages = validStages().map((stage) => {
    const override = overrides[stage.stageId];
    if (override === undefined) return stage;
    const metrics = { ...stage.metrics, ...override };
    return { ...stage, metrics, score: computeStageScore(stage.stageId, metrics) };
  });

  const body = await json<{ accepted: boolean }>(
    await api.completeRun(runId, { nickname, stages, totalScore: 0 }),
  );
  expect(body.accepted, `fixture for ${nickname} was rejected`).toBe(true);

  return runId;
}

const STRONG_LATE = { nearMissCount: 40, comboUnits: 40 };
const WEAK_LATE = { nearMissCount: 1, comboUnits: 1 };
// `timeRemainingSec` is capped against the stage's own duration (49s of a 90s
// limit leaves at most 42), so a bigger number here is not a stronger run - it is
// a rejected one.
const STRONG_TEACHER = { checkpointsCompleted: 6, timeRemainingSec: 40 };
const WEAK_TEACHER = { checkpointsCompleted: 2, timeRemainingSec: 1 };

describe('GET /api/leaderboard?stage=...', () => {
  it('ranks a stage board by that stage alone, not by the run total', async () => {
    // Deliberately opposed: each is the other's mirror image.
    await submitStages('はしる人', { late: STRONG_LATE, teacher: WEAK_TEACHER });
    await submitStages('かくれる人', { late: WEAK_LATE, teacher: STRONG_TEACHER });

    const late = await board('?period=all&stage=late');
    const teacher = await board('?period=all&stage=teacher');

    expect(late.entries.map((entry) => entry.nickname)).toEqual(['はしる人', 'かくれる人']);
    expect(teacher.entries.map((entry) => entry.nickname)).toEqual(['かくれる人', 'はしる人']);
    expect(late.scope).toBe('late');
  });

  it('shows a stage score, not the run total', async () => {
    await submitStages('ひとり', {});

    const total = await board('?period=all');
    const late = await board('?period=all&stage=late');

    expect(late.entries[0]?.score).toBeLessThan(total.entries[0]?.score ?? 0);
    expect(late.entries[0]?.score).toBe(
      computeStageScore('late', validStages()[0]!.metrics),
    );
  });

  it('puts a specialist top of their stage while they sit last overall', async () => {
    // Loses the other two stages badly, so the combined board buries them.
    await submitStages('パン職人', { late: WEAK_LATE, teacher: WEAK_TEACHER });
    // The clock is frozen, so without this both rows share a timestamp and the
    // tie-break below has nothing to order them by.
    api.clock.advanceSeconds(60);
    await submitStages('そこそこ', {});

    const total = await board('?period=all');
    const bread = await board('?period=all&stage=bread');

    expect(total.entries.at(-1)?.nickname).toBe('パン職人');
    // Both played bread identically, so the tie-break puts the earlier one first -
    // and that is the specialist, who would never surface on the combined board.
    expect(bread.entries[0]?.nickname).toBe('パン職人');
  });

  it('keeps a rejected run off the stage boards as well', async () => {
    await submitStages('しょうじき', {});

    const runId = await api.openRun();
    const stages = validStages().map((stage) => ({ ...stage, score: 999_999 }));
    await api.completeRun(runId, { nickname: 'ずる', stages, totalScore: 999_999 });

    const bread = await board('?period=all&stage=bread');

    expect(bread.entries.map((entry) => entry.nickname)).toEqual(['しょうじき']);
    expect(bread.total).toBe(1);
  });

  it('does not rank a stage result played under an older rule set', async () => {
    await submitStages('いま', {});

    const oldRun = '00000000-0000-4000-8000-0000000002d0';
    await api.db.query(
      `INSERT INTO runs (id, seed, config_version, started_at, expires_at, completed_at, status)
       VALUES ($1, 1, $2, $3, $3, $3, 'completed')`,
      [oldRun, RULES.configVersion - 1, api.clock.now()],
    );
    await api.db.query(
      `INSERT INTO scores (run_id, nickname, total_score, created_at, valid, suspicion_score, config_version)
       VALUES ($1, 'むかし', 999999, $2, 1, 0, $3)`,
      [oldRun, api.clock.now(), RULES.configVersion - 1],
    );
    await api.db.query(
      `INSERT INTO stage_results (run_id, stage_id, score, client_score, duration_ms, metrics_json)
       VALUES ($1, 'late', 999999, 999999, 20000, '{}')`,
      [oldRun],
    );

    const late = await board('?period=all&stage=late');

    expect(late.entries.map((entry) => entry.nickname)).toEqual(['いま']);
  });

  it('gives the caller their placement on a stage board', async () => {
    const mine = await submitStages('わたし', { late: WEAK_LATE });
    for (let i = 0; i < 4; i++) await submitStages(`つよい${i}`, { late: STRONG_LATE });

    const late = await board(`?period=all&stage=late&limit=2&runId=${mine}`);

    expect(late.entries).toHaveLength(2);
    expect(late.me?.nickname).toBe('わたし');
    expect(late.me?.rank).toBe(5);
  });

  it('honours the daily boundary on a stage board', async () => {
    await submitStages('きのう', { late: STRONG_LATE });
    api.clock.advanceSeconds(2 * 24 * 60 * 60);
    await submitStages('きょう', { late: WEAK_LATE });

    expect((await board('?period=today&stage=late')).entries.map((e) => e.nickname)).toEqual([
      'きょう',
    ]);
    expect((await board('?period=all&stage=late')).entries.map((e) => e.nickname)).toEqual([
      'きのう',
      'きょう',
    ]);
  });

  it('falls back to the combined board for a stage that does not exist', async () => {
    await submitStages('だれか', {});

    const result = await board('?period=all&stage=kendo');

    expect(result.scope).toBe('total');
    expect(result.entries[0]?.score).toBe((await board('?period=all')).entries[0]?.score);
  });

  it('treats an injection attempt as an unknown stage rather than running it', async () => {
    await submitStages('だれか', {});

    const result = await board(
      `?period=all&stage=${encodeURIComponent("late' OR 1=1--")}`,
    );

    expect(result.scope).toBe('total');
    expect(result.entries).toHaveLength(1);
  });
});
