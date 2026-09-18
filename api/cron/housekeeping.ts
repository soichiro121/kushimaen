/**
 * Periodic cleanup, triggered by Vercel Cron (see `vercel.json`).
 *
 * Removes abandoned runs and stale rate-limit windows so those tables stay small.
 * Completed runs and scores are NEVER touched - those are the leaderboard.
 *
 * Protected by `CRON_SECRET`: Vercel sends it as a bearer token, and without a match
 * this is a 404. An open endpoint that deletes rows is not something to leave lying
 * around, and a 404 does not advertise that it exists.
 */
import { optionalEnv } from '../../server/config/env';
import { database } from '../../server/db/neon';
import { deleteExpiredRunsBefore } from '../../server/repository/runs';
import { purgeRateLimitsBefore } from '../../server/repository/rateLimits';
import { logger } from '../../server/support/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(request: Request): Promise<Response> {
  const secret = optionalEnv('CRON_SECRET');
  const authorized =
    secret !== undefined && request.headers.get('authorization') === `Bearer ${secret}`;
  if (!authorized) return new Response('Not Found', { status: 404 });

  const db = database();
  const now = new Date();

  // A grace period, so a run that is merely slow to finish is never deleted.
  const runs = await deleteExpiredRunsBefore(db, new Date(now.getTime() - DAY_MS));
  const windows = await purgeRateLimitsBefore(db, new Date(now.getTime() - DAY_MS));

  logger.info('housekeeping', { runs, windows });

  return new Response(JSON.stringify({ runs, windows }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
