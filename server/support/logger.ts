/**
 * Logging.
 *
 * Serverless functions have no durable filesystem, so logs go to stdout/stderr and
 * the platform collects them. Structured as JSON lines so a suspicious submission
 * can actually be searched for later.
 *
 * NEVER log a nickname, a raw IP address or anything else a player typed - the
 * fields below are ids, counters and issue codes only.
 */

type Fields = Record<string, unknown>;

function emit(stream: 'log' | 'warn' | 'error', message: string, fields: Fields): void {
  // stdout/stderr IS the log sink on Vercel; the lint rule is relaxed for `server/`.
  console[stream](JSON.stringify({ level: stream, message, ...fields }));
}

export const logger = {
  info: (message: string, fields: Fields = {}): void => emit('log', message, fields),
  warn: (message: string, fields: Fields = {}): void => emit('warn', message, fields),
  error: (message: string, fields: Fields = {}): void => emit('error', message, fields),
};
