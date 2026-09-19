/**
 * Adapts a Web handler to the shape Vercel's Node runtime actually recognises.
 *
 * THIS IS NOT CEREMONY. A bare `export default someHandler` is interpreted by Vercel
 * as the LEGACY Node signature - the function is called with `(IncomingMessage,
 * ServerResponse)`, not with a `Request`. Our handlers are Web handlers, so they went
 * looking for `request.headers.get(...)` on an object that has no such method, threw,
 * and every route returned FUNCTION_INVOCATION_FAILED. The game reads a failing
 * `/api/health` as "no server" and drops the player into LOCAL MODE, so the symptom
 * appeared nowhere near the cause.
 *
 * Wrapping in `{ fetch }` is one of the two documented Web-handler forms (the other
 * being named `GET`/`POST` exports). This one is preferred here because our own
 * pipeline already handles the method check, OPTIONS and CORS - splitting routing
 * across two mechanisms would mean two places to get it wrong.
 *
 * https://vercel.com/docs/functions/runtimes/node-js
 */
import type { Handler } from './route.js';

export interface VercelFunction {
  fetch: Handler;
}

export function vercelFunction(handler: Handler): VercelFunction {
  return { fetch: handler };
}
