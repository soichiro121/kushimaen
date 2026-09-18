/**
 * The API, as plain Web handlers.
 *
 * The files under `api/` are one-line re-exports of these, because that directory's
 * layout is Vercel's routing convention rather than something the code should care
 * about. Keeping the handlers here means the tests import the real thing, and moving
 * to another host later is a matter of re-pointing the thin files.
 */
import { RULES } from '../../shared/core/rules';
import { isRunId } from '../domain/run';
import { board, parseLimit, parsePeriod } from '../service/leaderboardService';
import { completeRun, createRun } from '../service/runService';
import { parseSubmission } from '../validation/submissionRequest';
import { ApiError } from './apiError';
import { createRoute, json, type Handler } from './route';
import type { Clock } from '../support/clock';
import type { Database } from '../db/types';
import type { HealthResponse } from '../../shared/core/api';

export interface RouteDeps {
  db?: Database;
  clock?: Clock;
}

/**
 * Liveness, and the config version the client must agree with.
 *
 * Deliberately exempt from the rate limit: the game polls it to decide whether to run
 * in remote or LOCAL mode, and a throttled health check would strand a player offline.
 */
export function healthRoute(deps: RouteDeps = {}): Handler {
  return createRoute(
    {
      method: 'GET',
      rateLimit: false,
      handle: async ({ clock }) => {
        const body: HealthResponse = {
          status: 'ok',
          configVersion: RULES.configVersion,
          serverTime: clock.now().toISOString(),
        };
        return json(body);
      },
    },
    deps,
  );
}

export function createRunRoute(deps: RouteDeps = {}): Handler {
  return createRoute(
    {
      method: 'POST',
      handle: async ({ db, clock }) => json(await createRun(db, clock), 201),
    },
    deps,
  );
}

export function completeRunRoute(deps: RouteDeps = {}): Handler {
  return createRoute(
    {
      method: 'POST',
      handle: async ({ db, clock, url, body }) => {
        // `/api/runs/{runId}/complete` - read from the path rather than the body so a
        // client cannot submit for one run while claiming another.
        const segments = url.pathname.split('/').filter(Boolean);
        const runId = segments[segments.length - 2] ?? '';

        // Shape-checked before it reaches the database. Combined with parameterised
        // queries this means a malformed id is a 404, never a query.
        if (!isRunId(runId)) {
          throw ApiError.notFound('unknown_run', 'このプレイは見つかりませんでした');
        }

        const submission = parseSubmission(body);
        const result = await completeRun(
          db,
          clock,
          runId,
          submission.nickname,
          submission.stages,
          submission.totalScore,
        );
        return json(result);
      },
    },
    deps,
  );
}

export function leaderboardRoute(deps: RouteDeps = {}): Handler {
  return createRoute(
    {
      method: 'GET',
      handle: async ({ db, clock, url }) => {
        const runId = url.searchParams.get('runId');
        return json(
          await board(
            db,
            clock.now(),
            parsePeriod(url.searchParams.get('period')),
            parseLimit(url.searchParams.get('limit')),
            isRunId(runId) ? runId : null,
          ),
        );
      },
    },
    deps,
  );
}
