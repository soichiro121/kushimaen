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
