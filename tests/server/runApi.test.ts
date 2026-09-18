// @vitest-environment node
/**
 * End-to-end tests for the run lifecycle, through the real HTTP stack.
 *
 * These are the tests that pin the anti-cheat promise: a client cannot put a number
 * on the leaderboard just by sending one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES } from '@shared/core/rules';
import { computeStageScore } from '@shared/core/scoring';
import { createTestApi, json, stagesWith, validStages, type TestApi } from './support/api';

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

describe('POST /api/runs', () => {
  it('issues a server-side seed and expiry', async () => {
    const response = await api.postRun();
    const body = await json<{
      runId: string;
      seed: number;
      configVersion: number;
      expiresAt: string;
    }>(response);

    expect(response.status).toBe(201);
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.seed).toBeGreaterThanOrEqual(0);
    expect(body.seed).toBeLessThanOrEqual(0xffffffff);
    expect(body.configVersion).toBe(RULES.configVersion);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(api.clock.now().getTime());
  });

  it('gives two runs different ids and different seeds', async () => {
    const first = await json<{ runId: string; seed: number }>(await api.postRun());
    const second = await json<{ runId: string; seed: number }>(await api.postRun());

    expect(first.runId).not.toBe(second.runId);
    // A collision here would be a 1-in-4-billion fluke; a repeat means the seed is
    // not actually random, which would let players pre-scout a layout.
    expect(first.seed).not.toBe(second.seed);
  });
});

describe('POST /api/runs/:runId/complete', () => {
  it('stores the server-computed total and ignores the claimed one', async () => {
    const runId = await api.openRun();
    const stages = validStages();

    const response = await api.completeRun(runId, {
      nickname: 'テスト太郎',
      stages,
      // A blatant lie. It must have no effect whatsoever.
      totalScore: 999_999_999,
    });
    const body = await json<{ accepted: boolean; totalScore: number; rank: number }>(response);

    const expected = stages.reduce(
      (sum, stage) => sum + computeStageScore(stage.stageId, stage.metrics),
      0,
    );

    expect(response.status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.totalScore).toBe(expected);
    expect(body.rank).toBe(1);
  });

  it('rejects an inflated per-stage score and keeps it off the board', async () => {
    const runId = await api.openRun();
    // The DevTools attack: inflate every reported score, leave the metrics alone.
    const stages = validStages().map((stage) => ({ ...stage, score: 1_000_000 }));

    const body = await json<{ accepted: boolean; totalScore: number; rank: number | null }>(
      await api.completeRun(runId, { nickname: 'cheater', stages, totalScore: 3_000_000 }),
    );

    // Three mismatches weigh 25 each, which crosses the rejection threshold.
    expect(body.accepted).toBe(false);
    expect(body.totalScore).toBeLessThan(40_000);
    expect(body.rank).toBeNull();

    const board = await json<{ entries: unknown[] }>(await api.leaderboard('?period=all'));
    expect(board.entries).toEqual([]);
  });

  it('rejects metrics the game could not physically produce', async () => {
    const runId = await api.openRun();
    // 5000 near misses in 24 seconds is not possible.
    const stages = stagesWith('late', { nearMissCount: 5000 });

    const body = await json<{ accepted: boolean }>(
      await api.completeRun(runId, { nickname: 'cheater', stages, totalScore: 0 }),
    );

    expect(body.accepted).toBe(false);
  });

  it('rejects combo units the hit count cannot support', async () => {
    const runId = await api.openRun();
    const stages = stagesWith('late', { comboUnits: 9999 });

    const body = await json<{ accepted: boolean }>(
      await api.completeRun(runId, { nickname: 'cheater', stages, totalScore: 0 }),
    );

    expect(body.accepted).toBe(false);
  });

  it('rejects an impossibly fast stage', async () => {
    const runId = await api.openRun();
    const stages = validStages();
    stages[0] = { ...stages[0]!, durationMs: 50 };

    const body = await json<{ accepted: boolean }>(
      await api.completeRun(runId, { nickname: 'speedhack', stages, totalScore: 0 }),
    );

    expect(body.accepted).toBe(false);
  });

  it('accepts a submission exactly once', async () => {
    const runId = await api.openRun();
    const payload = { nickname: 'テスト', stages: validStages(), totalScore: 0 };

    const first = await api.completeRun(runId, payload);
    expect(first.status).toBe(200);

    const second = await api.completeRun(runId, payload);
    expect(second.status).toBe(409);
    expect((await json<{ error: { code: string } }>(second)).error.code).toBe(
      'run_already_completed',
    );

    const board = await json<{ entries: unknown[] }>(await api.leaderboard('?period=all'));
    expect(board.entries).toHaveLength(1);
  });

  it('rejects an expired run', async () => {
    const runId = await api.openRun();
    api.clock.advanceSeconds(RULES.run.ttlSeconds + 60);

    const response = await api.completeRun(runId, {
      nickname: 'テスト',
      stages: validStages(),
      totalScore: 0,
    });

    expect(response.status).toBe(410);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('run_expired');
  });

  it('rejects an unknown run', async () => {
    const response = await api.completeRun('00000000-0000-4000-8000-000000000000', {
      nickname: 'テスト',
      stages: validStages(),
      totalScore: 0,
    });

    expect(response.status).toBe(404);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('unknown_run');
  });

  it('rejects a malformed run id before it can reach a query', async () => {
    const response = await api.completeRun("' OR 1=1--", {
      nickname: 'テスト',
      stages: validStages(),
      totalScore: 0,
    });

    expect(response.status).toBe(404);
  });

  it('rejects the same stage submitted twice', async () => {
    const runId = await api.openRun();
    const stages = validStages();
    stages.push(stages[0]!);

    const body = await json<{ accepted: boolean }>(
      await api.completeRun(runId, { nickname: 'テスト', stages, totalScore: 0 }),
    );

    expect(body.accepted).toBe(false);
  });

  it('rejects an empty submission', async () => {
    // The rejection is logged on purpose; the assertion is about the response.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runId = await api.openRun();

    const body = await json<{ accepted: boolean }>(
      await api.completeRun(runId, { nickname: 'テスト', stages: [], totalScore: 0 }),
    );

    expect(body.accepted).toBe(false);
    warn.mockRestore();
  });

  it('rejects a non-numeric metric as unprocessable', async () => {
    const runId = await api.openRun();
    const stages = validStages() as unknown as { metrics: Record<string, unknown> }[];
    stages[0]!.metrics.nearMissCount = 'lots';

    const response = await api.completeRun(runId, { nickname: 'テスト', stages, totalScore: 0 });

    expect(response.status).toBe(422);
  });

  it('rejects an unbounded metric map', async () => {
    const runId = await api.openRun();
    const metrics = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`metric${index}`, 1]),
    );
    const stages = [{ stageId: 'late', score: 0, durationMs: 24_000, metrics }];

    const response = await api.completeRun(runId, { nickname: 'テスト', stages, totalScore: 0 });

    expect(response.status).toBe(422);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('too_many_metrics');
  });

  it('rejects malformed JSON', async () => {
    const runId = await api.openRun();
    const response = await api.completeRun(runId, null, { body: '{not json' });

    expect(response.status).toBe(400);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('invalid_json');
  });

  it('rejects a body larger than the limit', async () => {
    const runId = await api.openRun();
    const response = await api.completeRun(runId, null, {
      body: JSON.stringify({ nickname: 'x'.repeat(200_000), stages: [], totalScore: 0 }),
    });

    expect(response.status).toBe(413);
  });
});

describe('the API surface itself', () => {
  it('reports the config version the client must agree with', async () => {
    const response = await api.health();
    const body = await json<{ status: string; configVersion: number }>(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.configVersion).toBe(RULES.configVersion);
  });

  it('carries security headers on every response, errors included', async () => {
    for (const response of [await api.health(), await api.completeRun('nope', {})]) {
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('answers JSON, not HTML, when the method is wrong', async () => {
    const response = await api.postRun({ method: 'DELETE' });

    expect(response.status).toBe(405);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('never leaks internal detail from an unexpected failure', async () => {
    // The failure is logged on purpose; the assertion is that it is NOT in the body.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A database that throws stands in for any unexpected server-side fault.
    const broken = {
      ...api.db,
      query: () => Promise.reject(new Error('connection to db-prod-7 refused: password=hunter2')),
    };
    const { createRunRoute } = await import('../../server/http/routes');
    const route = createRunRoute({ db: broken, clock: api.clock });

    const response = await route(new Request('https://komato.test/api/runs', { method: 'POST' }));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('db-prod-7');
    // ...but it IS in the logs, where an operator can actually use it.
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
