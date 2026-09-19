/**
 * `GET /api/health` - liveness, and the config version the client must agree with.
 *
 * THIS ROUTE IS DELIBERATELY ISOLATED. The game probes it to decide whether to run
 * against the API or fall back to LOCAL MODE, so anything it imports can take the
 * whole leaderboard offline. It previously reached the database driver through the
 * shared route pipeline, which meant a failure to load `ws` - a detail of talking to
 * Postgres - would silently demote every player to a local-only game.
 *
 * So: no database, no rate limit, no request body. Rules, a clock, and headers.
 */
import { RULES } from '../../shared/core/rules.js';
import { optionalEnv } from '../config/env.js';
import { systemClock, type Clock } from '../support/clock.js';
import { applyCors, json, securityHeaders } from './headers.js';
import type { HealthResponse } from '../../shared/core/api.js';

export function healthRoute(deps: { clock?: Clock } = {}) {
  const clock = deps.clock ?? systemClock;

  return async function handler(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return securityHeaders(applyCors(request, new Response(null, { status: 204 })));
    }
    if (request.method !== 'GET') {
      return securityHeaders(
        applyCors(
          request,
          json(
            {
              error: { code: 'method_not_allowed', message: 'このリクエストは受け付けていません' },
            },
            405,
          ),
        ),
      );
    }

    const body: HealthResponse = {
      status: 'ok',
      configVersion: RULES.configVersion,
      serverTime: clock.now().toISOString(),
      // Whether the database is CONFIGURED, not whether it answers - this route never
      // opens a connection. It is here because "the game works but nothing reaches the
      // leaderboard" is otherwise a very hard thing to diagnose on a fresh deployment.
      checks: {
        database: optionalEnv('DATABASE_URL') === undefined ? 'unconfigured' : 'configured',
      },
    };

    return securityHeaders(applyCors(request, json(body)));
  };
}
