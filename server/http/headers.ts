/**
 * Response helpers shared by every route.
 *
 * Deliberately free of any database import. `/api/health` is the endpoint that
 * decides whether the game runs against the API at all, so its dependency list has to
 * be as short as possible - see `health.ts`.
 */
import { CONFIG } from '../config/env.js';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function securityHeaders(response: Response): Response {
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
 * The game and the API are served from the SAME origin in the normal deployment, so
 * no CORS headers are needed at all and `CORS_ALLOWED_ORIGINS` stays empty. This
 * exists for a split deployment, and it echoes back only an origin that is explicitly
 * on the list - never `*`.
 */
export function applyCors(request: Request, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin) return response;

  if (!CONFIG.corsAllowedOrigins().includes(origin)) return response;

  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Vary', 'Origin');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  response.headers.set('Access-Control-Max-Age', '600');
  return response;
}
