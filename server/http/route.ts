/**
 * The request pipeline every API route runs through.
 *
 * Routes are plain Web handlers - `(Request) => Response`. That choice is what makes
 * the API testable without mocking a platform: the test suite constructs a real
 * `Request`, calls the same exported handler the deployment calls, and asserts the
 * real `Response`, middleware and all.
 *
 * Order, outermost first:
 *
 *   errors            -> anything unexpected becomes a generic JSON 500
 *   security headers  -> nosniff, DENY, no-store
 *   CORS              -> only for a configured cross-origin deployment
 *   method check      -> 405 rather than running the handler
 *   rate limit        -> shared counter in the database
 *   body              -> size-limited, strictly parsed JSON
 */
import { CONFIG, isProduction } from '../config/env.js';
import { database } from '../db/neon.js';
import { hitRateLimit } from '../repository/rateLimits.js';
import { ApiError, isApiError } from './apiError.js';
import { logger } from '../support/logger.js';
import { systemClock, type Clock } from '../support/clock.js';
import type { Database } from '../db/types.js';

export interface RouteContext {
  readonly request: Request;
  readonly url: URL;
  readonly db: Database;
  readonly clock: Clock;
  /** Parsed JSON body, or `undefined` for GET. Already size-checked. */
  readonly body: unknown;
}

export interface RouteOptions {
  readonly method: 'GET' | 'POST';
  /** Applies the shared rate limit. Off for `/api/health`, which must stay cheap. */
  readonly rateLimit?: boolean;
  handle(context: RouteContext): Promise<Response>;
}

export type Handler = (request: Request) => Promise<Response>;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function securityHeaders(response: Response): Response {
  // Set on the way out so they are present on error responses too.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  // A leaderboard that is cached is a leaderboard that is wrong.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * CORS.
 *
 * The frontend and the API are served from the SAME origin in the normal deployment,
 * so no CORS headers are needed at all and `CORS_ALLOWED_ORIGINS` stays empty. It
 * exists for the split deployment (frontend on one host, API on another), and it
 * echoes back only an origin that is explicitly on the list - never `*`.
 */
function applyCors(request: Request, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin) return response;

  const allowed = CONFIG.corsAllowedOrigins();
  if (!allowed.includes(origin)) return response;

  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Vary', 'Origin');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  response.headers.set('Access-Control-Max-Age', '600');
  return response;
}

/** Best-effort client identity for rate limiting. Hashed before it is stored. */
function clientBucket(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

async function readJsonBody(request: Request): Promise<unknown> {
  const limit = CONFIG.maxBodyBytes();

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    throw new ApiError(413, 'payload_too_large', 'データが大きすぎます');
  }

  const text = await request.text();
  if (text.length === 0) return undefined;
  // Checked again on the actual bytes: `content-length` is a claim, not a fact.
  if (text.length > limit) {
    throw new ApiError(413, 'payload_too_large', 'データが大きすぎます');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw ApiError.badRequest('invalid_json', 'リクエストの形式が不正です');
  }
}

export function createRoute(
  options: RouteOptions,
  deps: { db?: Database; clock?: Clock } = {},
): Handler {
  return async function handler(request: Request): Promise<Response> {
    try {
      if (request.method === 'OPTIONS') {
        return securityHeaders(applyCors(request, new Response(null, { status: 204 })));
      }
      if (request.method !== options.method) {
        throw new ApiError(405, 'method_not_allowed', 'このリクエストは受け付けていません');
      }

      const db = deps.db ?? database();
      const clock = deps.clock ?? systemClock;

      if (options.rateLimit !== false) {
        const outcome = await hitRateLimit(
          db,
          clientBucket(request),
          CONFIG.rateLimitPerWindow(),
          CONFIG.rateLimitWindowSeconds(),
          clock.now(),
        );
        if (!outcome.allowed) {
          return securityHeaders(
            applyCors(
              request,
              json(
                {
                  error: {
                    code: 'rate_limited',
                    message: '混み合っています。少し待ってからもう一度お試しください',
                  },
                },
                429,
                {
                  'Retry-After': String(outcome.retryAfter),
                },
              ),
            ),
          );
        }
      }

      const body = options.method === 'POST' ? await readJsonBody(request) : undefined;
      const response = await options.handle({
        request,
        url: new URL(request.url),
        db,
        clock,
        body,
      });

      return securityHeaders(applyCors(request, response));
    } catch (error) {
      return securityHeaders(applyCors(request, toErrorResponse(error)));
    }
  };
}

/**
 * Turns anything thrown into a JSON response.
 *
 * An unexpected error becomes a bare 500 with no detail: an exception message or a
 * SQL error reaching the client is an information leak. The detail goes to the logs
 * instead, where it is actually useful.
 */
function toErrorResponse(error: unknown): Response {
  if (isApiError(error)) {
    return json({ error: { code: error.code, message: error.publicMessage } }, error.status);
  }

  logger.error('unhandled error', {
    detail: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return json(
    {
      error: {
        code: 'internal_error',
        message: 'サーバーで問題が発生しました。しばらくしてからお試しください',
        // Only ever populated outside production, and only for the developer running it.
        ...(isProduction()
          ? {}
          : { detail: error instanceof Error ? error.message : String(error) }),
      },
    },
    500,
  );
}
