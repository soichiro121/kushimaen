// @vitest-environment node
/**
 * The parts of the API that are not a game rule: migrations, rate limiting, and what
 * actually gets stored when a player types something hostile into the nickname box.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../../server/db/migrate';
import { hitRateLimit } from '../../server/repository/rateLimits';
import { startOfLocalDay } from '../../server/repository/scores';
import { createTestApi, json, validStages, type TestApi } from './support/api';
import { createTestDatabase } from './support/database';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

beforeEach(async () => {
  await api.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await api.close();
});

describe('migrations', () => {
  it('ships at least one migration and applies it', async () => {
    expect(loadMigrations().length).toBeGreaterThan(0);

    const { rows } = await api.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((row) => row.table_name).sort();

    expect(tables).toContain('runs');
    expect(tables).toContain('scores');
    expect(tables).toContain('stage_results');
    expect(tables).toContain('rate_limits');
  });

  it('is idempotent - running it again applies nothing', async () => {
    const applied = await applyMigrations(api.db);

    expect(applied).toEqual([]);
  });

  it('applies cleanly to an empty database', async () => {
    // Guards against a migration that only works because an earlier state existed.
    const fresh = await createTestDatabase();
    try {
      expect(await applyMigrations(fresh)).toEqual([]);
    } finally {
      await fresh.close();
    }
  });
});

describe('rate limiting', () => {
  it('allows traffic up to the limit and then refuses it', async () => {
    const now = api.clock.now();
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await hitRateLimit(api.db, 'tester', 3, 60, now));
    }

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
    expect(results[3]?.retryAfter).toBeGreaterThan(0);
  });

  it('counts each caller separately', async () => {
    const now = api.clock.now();
    for (let i = 0; i < 4; i++) await hitRateLimit(api.db, 'noisy', 2, 60, now);

    expect((await hitRateLimit(api.db, 'quiet', 2, 60, now)).allowed).toBe(true);
  });

  it('forgives the caller once the window rolls over', async () => {
    const now = api.clock.now();
    for (let i = 0; i < 4; i++) await hitRateLimit(api.db, 'tester', 2, 60, now);

    const later = new Date(now.getTime() + 61_000);
    expect((await hitRateLimit(api.db, 'tester', 2, 60, later)).allowed).toBe(true);
  });

  it('never stores a raw client identifier', async () => {
    await hitRateLimit(api.db, '203.0.113.42', 10, 60, api.clock.now());

    const { rows } = await api.db.query<{ bucket: string }>('SELECT bucket FROM rate_limits');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.bucket).not.toContain('203.0.113');
    expect(rows[0]?.bucket.trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('turns a flood into a 429 with a Retry-After header', async () => {
    vi.stubEnv('RATE_LIMIT_PER_WINDOW', '2');

    const responses = [await api.postRun(), await api.postRun(), await api.postRun()];

    expect(responses.map((response) => response.status)).toEqual([201, 201, 429]);
    expect(responses[2]?.headers.get('Retry-After')).toBeTruthy();
    expect((await json<{ error: { code: string } }>(responses[2]!)).error.code).toBe(
      'rate_limited',
    );
  });

  it('never throttles the health check, which decides remote vs local mode', async () => {
    vi.stubEnv('RATE_LIMIT_PER_WINDOW', '1');

    for (let i = 0; i < 5; i++) {
      expect((await api.health()).status).toBe(200);
    }
  });
});

describe('what actually gets stored', () => {
  async function submitAs(nickname: string): Promise<string> {
    const runId = await api.openRun();
    await api.completeRun(runId, { nickname, stages: validStages(), totalScore: 0 });
    const { rows } = await api.db.query<{ nickname: string }>(
      'SELECT nickname FROM scores WHERE run_id = $1',
      [runId],
    );
    return rows[0]?.nickname ?? '';
  }

  it('strips control and invisible characters before they reach the table', async () => {
    // Built from code points on purpose: a literal NUL or zero-width space in a
    // source file is invisible in an editor and trips up other tooling.
    const NUL = String.fromCharCode(0x00);
    const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

    expect(await submitAs(`あ${NUL}い${ZERO_WIDTH_SPACE}う`)).toBe('あいう');
  });

  it('collapses whitespace used to shove a name across the board', async () => {
    expect(await submitAs('  a \n\n   b  ')).toBe('a b');
  });

  it('truncates by code point so an emoji is never cut in half', async () => {
    const stored = await submitAs('🍞'.repeat(40));

    expect([...stored]).toHaveLength(12);
    expect(stored.endsWith('🍞')).toBe(true);
  });

  it('refuses a name that is empty once cleaned', async () => {
    const runId = await api.openRun();
    const response = await api.completeRun(runId, {
      // Zero-width spaces: visually empty, but a naive length check would accept it.
      nickname: String.fromCharCode(0x200b, 0x200b, 0xfeff),
      stages: validStages(),
      totalScore: 0,
    });

    expect(response.status).toBe(422);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe('invalid_nickname');
  });

  it('records the server score and the claimed one side by side for review', async () => {
    const runId = await api.openRun();
    const stages = validStages().map((stage) => ({ ...stage, score: stage.score + 1000 }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await api.completeRun(runId, { nickname: 'ずる', stages, totalScore: 0 });

    const { rows } = await api.db.query<{ score: number; client_score: number }>(
      'SELECT score, client_score FROM stage_results WHERE run_id = $1 ORDER BY stage_id',
      [runId],
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(Number(row.client_score)).toBe(Number(row.score) + 1000);
    }
  });
});

describe('the daily board boundary', () => {
  it('rolls over at local midnight, not UTC midnight', () => {
    // 2026-05-01T09:00Z is 18:00 on 1 May in Tokyo, so "today" began at 15:00Z on
    // 30 April. Using UTC midnight would move the boundary into the school day.
    const start = startOfLocalDay(new Date('2026-05-01T09:00:00Z'), 'Asia/Tokyo');

    expect(start.toISOString()).toBe('2026-04-30T15:00:00.000Z');
  });

  it('follows whatever timezone the operator configured', () => {
    const start = startOfLocalDay(new Date('2026-05-01T09:00:00Z'), 'UTC');

    expect(start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});
