/**
 * The production database: Neon Postgres over a pooled WebSocket connection.
 *
 * WHY THE WEBSOCKET DRIVER AND NOT THE HTTP ONE: closing a run has to be atomic -
 * claim the run, write its stage rows and write its score, all or nothing. The HTTP
 * driver can only batch a fixed list of statements, which cannot express "only insert
 * if the claim actually succeeded". The pooled driver gives real BEGIN/COMMIT.
 *
 * `ws` is wired in explicitly rather than relying on a global `WebSocket`, because
 * whether one exists depends on the Node version the platform happens to run.
 */
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { requireEnv } from '../config/env.js';
import type { Database, QueryResult, SqlClient } from './types.js';

neonConfig.webSocketConstructor = ws;

/**
 * One pool per warm function instance. Vercel reuses the module between invocations,
 * so this is created once and re-used rather than dialling the database per request.
 */
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: requireEnv('DATABASE_URL') });
    // A connection error on an idle pooled socket must not take the process down.
    pool.on('error', () => undefined);
  }
  return pool;
}

function wrap(client: {
  query: (
    text: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}): SqlClient {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<QueryResult<Row>> {
      const result = await client.query(text, params);
      return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
    },

    async exec(sql: string): Promise<void> {
      // No parameters, so this goes through the simple query protocol - which is
      // what allows a migration file to contain several statements.
      await client.query(sql);
    },
  };
}

export function createNeonDatabase(): Database {
  return {
    query: (text, params) => wrap(getPool()).query(text, params),

    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        // A failed rollback must not mask the error that caused it.
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    exec: (sql) => wrap(getPool()).exec(sql),

    async close(): Promise<void> {
      const current = pool;
      pool = null;
      await current?.end();
    },
  };
}

/** Shared instance for the route handlers. */
let shared: Database | null = null;

export function database(): Database {
  return (shared ??= createNeonDatabase());
}
