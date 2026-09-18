/**
 * Fixed-window rate limiting, stored in the database.
 *
 * Serverless functions scale out horizontally, so an in-process counter would not
 * actually limit anything - the shared store has to be the database. A fixed window
 * is coarse but adequate: the goal is to stop a script hammering `POST /api/runs`,
 * not to police a precise request budget.
 *
 * The bucket key is a SHA-256 hash. A raw IP address is never stored.
 */
import { createHash } from 'node:crypto';
import type { SqlClient } from '../db/types';

export interface RateLimitOutcome {
  readonly allowed: boolean;
  /** Seconds until the current window rolls over. */
  readonly retryAfter: number;
}

function windowStart(now: Date, windowSeconds: number): Date {
  const seconds = Math.floor(now.getTime() / 1000);
  return new Date((seconds - (seconds % windowSeconds)) * 1000);
}

export async function hitRateLimit(
  db: SqlClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: Date,
): Promise<RateLimitOutcome> {
  const key = createHash('sha256').update(bucket).digest('hex');
  const start = windowStart(now, windowSeconds);

  // One atomic statement: two functions hitting the same window concurrently both
  // get counted, and the row is created on first use.
  const { rows } = await db.query<{ hits: number | string }>(
    `INSERT INTO rate_limits (bucket, window_start, hits)
     VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start)
     DO UPDATE SET hits = rate_limits.hits + 1
     RETURNING hits`,
    [key, start],
  );

  const hits = Number(rows[0]?.hits ?? 0);
  const elapsed = Math.floor(now.getTime() / 1000) % windowSeconds;

  return { allowed: hits <= limit, retryAfter: Math.max(1, windowSeconds - elapsed) };
}

/** Housekeeping so the table cannot grow without bound. */
export async function purgeRateLimitsBefore(db: SqlClient, cutoff: Date): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM rate_limits WHERE window_start < $1', [cutoff]);
  return rowCount;
}
