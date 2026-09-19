/**
 * The API, as plain Web handlers.
 *
 * The files under `api/` are one-line re-exports of these, because that directory's
 * layout is Vercel's routing convention rather than something the code should care
 * about. Keeping the handlers here means the tests import the real thing, and moving
 * to another host later is a matter of re-pointing the thin files.
 */
import { isRunId } from '../domain/run.js';
import { board, parseLimit, parsePeriod } from '../service/leaderboardService.js';
import { completeRun, createRun } from '../service/runService.js';
import { parseSubmission } from '../validation/submissionRequest.js';
import { ApiError } from './apiError.js';
import { createRoute, json, type Handler } from './route.js';
import type { Clock } from '../support/clock.js';
import type { Database } from '../db/types.js';

// Re-exported so the tests and `api/health.ts` reach the same handler, even though it
// deliberately lives outside this module's dependency graph.
export { healthRoute } from './health.js';

export interface RouteDeps {
  db?: Database;
  clock?: Clock;
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
