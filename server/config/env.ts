/**
 * Environment access.
 *
 * Secrets (the database URL, the cron secret) come from Vercel's environment
 * variables and are never committed. `.env.example` documents every key; `.env` is
 * git-ignored.
 *
 * Reads go through here rather than touching `process.env` directly so that a missing
 * required value fails loudly at the edge of the app instead of becoming `undefined`
 * somewhere deep in a query.
 */

export class MissingEnvError extends Error {
  constructor(key: string) {
    super(
      `Required environment variable ${key} is not set. ` +
        'See .env.example and docs/DEPLOYMENT.md.',
    );
    this.name = 'MissingEnvError';
  }
}

function raw(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

export function requireEnv(key: string): string {
  const value = raw(key);
  if (value === undefined) throw new MissingEnvError(key);
  return value;
}

export function optionalEnv(key: string): string | undefined {
  return raw(key);
}

export function envInt(key: string, fallback: number): number {
  const value = raw(key);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Comma-separated list, e.g. `CORS_ALLOWED_ORIGINS`. Empty when unset. */
export function envList(key: string): string[] {
  const value = raw(key);
  if (value === undefined) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * True in a deployed environment. Controls whether error responses may carry an
 * exception message - they must not in production (API error information leakage).
 */
export function isProduction(): boolean {
  return (raw('APP_ENV') ?? process.env.VERCEL_ENV ?? 'production') === 'production';
}

export const CONFIG = {
  /** Timezone that decides what "today" means on the daily leaderboard. */
  timezone: () => raw('APP_TIMEZONE') ?? 'Asia/Tokyo',
  rateLimitPerWindow: () => envInt('RATE_LIMIT_PER_WINDOW', 120),
  rateLimitWindowSeconds: () => envInt('RATE_LIMIT_WINDOW_SECONDS', 60),
  /** Largest request body accepted, in bytes. */
  maxBodyBytes: () => envInt('MAX_BODY_BYTES', 32 * 1024),
  corsAllowedOrigins: () => envList('CORS_ALLOWED_ORIGINS'),
} as const;
