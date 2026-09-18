/**
 * Test harness for the API.
 *
 * Builds the REAL route handlers against a real PostgreSQL (PGlite) and a frozen
 * clock, then drives them with real `Request` objects. Nothing is stubbed: a test
 * here exercises the same middleware, the same SQL and the same scoring code that a
 * deployed request does.
 */
import { FrozenClock } from '../../../server/support/clock';
import {
  completeRunRoute,
  createRunRoute,
  healthRoute,
  leaderboardRoute,
} from '../../../server/http/routes';
import { computeStageScore } from '../../../shared/core/scoring';
import { createTestDatabase } from './database';
import type { StageSubmission } from '../../../shared/core/api';
import type { Database } from '../../../server/db/types';

const ORIGIN = 'https://komato.test';

export interface TestApi {
  readonly db: Database;
  readonly clock: FrozenClock;
  /**
   * Empties every table and rewinds the clock.
   *
   * Spinning up a fresh PGlite instance per test costs about five seconds, which
   * would put this suite over a minute and a half. One instance per file with a
   * truncate between tests gives the same isolation in milliseconds.
   */
  reset(): Promise<void>;
  health(): Promise<Response>;
  postRun(init?: RequestInit): Promise<Response>;
  completeRun(runId: string, body: unknown, init?: RequestInit): Promise<Response>;
  leaderboard(query?: string): Promise<Response>;
  /** Opens a run through the API and returns its id. */
  openRun(): Promise<string>;
  close(): Promise<void>;
}

export async function createTestApi(startedAt = '2026-05-01T09:00:00.000Z'): Promise<TestApi> {
  const db = await createTestDatabase();
  const origin = new Date(startedAt);
  const clock = new FrozenClock(origin);
  const deps = { db, clock };

  const routes = {
    health: healthRoute(deps),
    create: createRunRoute(deps),
    complete: completeRunRoute(deps),
    board: leaderboardRoute(deps),
  };

  const api: TestApi = {
    db,
    clock,
    health: () => routes.health(new Request(`${ORIGIN}/api/health`)),

    postRun: (init = {}) =>
      routes.create(new Request(`${ORIGIN}/api/runs`, { method: 'POST', ...init })),

    completeRun: (runId, body, init = {}) =>
      routes.complete(
        new Request(`${ORIGIN}/api/runs/${runId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          ...init,
        }),
      ),

    leaderboard: (query = '') => routes.board(new Request(`${ORIGIN}/api/leaderboard${query}`)),

    async reset(): Promise<void> {
      // `runs` cascades into scores and stage_results.
      await db.exec('TRUNCATE runs, rate_limits CASCADE');
      clock.reset(origin);
    },

    async openRun(): Promise<string> {
      const response = await api.postRun();
      if (response.status !== 201) {
        throw new Error(`openRun expected 201, got ${response.status}`);
      }
      const body = (await response.json()) as { runId: string };
      return body.runId;
    },

    close: () => db.close(),
  };

  return api;
}

export async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * A clean, self-consistent submission: every claimed score matches what the server
 * will recompute, so these stages are accepted unless a test deliberately breaks one.
 */
export function validStages(): StageSubmission[] {
  const late = {
    nearMissCount: 14,
    comboUnits: 18,
    collisionCount: 1,
    maxCombo: 5,
    goalReached: 1,
    timeRemainingSec: 6,
  };
  const bread = {
    questionCount: 8,
    correctCount: 7,
    mistakeCount: 1,
    speedUnits: 30,
    comboUnits: 12,
    maxCombo: 5,
    totalReactionMs: 9800,
  };
  const teacher = {
    cleared: 1,
    checkpointsCompleted: 3,
    timeRemainingSec: 41,
    caughtCount: 1,
    detectionCount: 2,
    dangerPassCount: 2,
    perfectStealth: 0,
    routeDistance: 9200,
    idleTimeMs: 4200,
  };

  return [
    { stageId: 'late', score: computeStageScore('late', late), durationMs: 24_000, metrics: late },
    {
      stageId: 'bread',
      score: computeStageScore('bread', bread),
      durationMs: 22_000,
      metrics: bread,
    },
    {
      stageId: 'teacher',
      score: computeStageScore('teacher', teacher),
      durationMs: 49_000,
      metrics: teacher,
    },
  ];
}

/** `validStages()` with one stage's metrics overridden, and its score kept honest. */
export function stagesWith(
  stageId: 'late' | 'bread' | 'teacher',
  overrides: Record<string, number>,
  durationMs?: number,
): StageSubmission[] {
  return validStages().map((stage) => {
    if (stage.stageId !== stageId) return stage;
    const metrics = { ...stage.metrics, ...overrides };
    return {
      ...stage,
      metrics,
      score: computeStageScore(stageId, metrics),
      durationMs: durationMs ?? stage.durationMs,
    };
  });
}
