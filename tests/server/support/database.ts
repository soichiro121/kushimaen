/**
 * The test database: PGlite, a real PostgreSQL compiled to WebAssembly, running
 * in-process.
 *
 * This matters more than it sounds. The alternative - a hand-written fake repository
 * layer - would test the mock rather than the SQL, and every one of this API's
 * integrity guarantees IS SQL: the conditional UPDATE that makes a double submission
 * impossible, the config-version filter that segregates balance generations, the
 * upsert behind the rate limiter. Those are asserted here against a real engine, with
 * the same migrations production runs.
 */
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../../../server/db/migrate';
import type { Database, QueryResult, SqlClient } from '../../../server/db/types';

interface PgLiteLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}

function wrap(client: PgLiteLike): SqlClient {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<QueryResult<Row>> {
      const result = await client.query(text, [...params]);
      return {
        rows: result.rows as Row[],
        // PGlite reports `affectedRows` for writes and leaves it unset for reads.
        rowCount: result.affectedRows ?? result.rows.length,
      };
    },
    async exec(sql: string): Promise<void> {
      await client.exec(sql);
    },
  };
}

export async function createTestDatabase(): Promise<Database> {
  const pg = await PGlite.create();

  const db: Database = {
    query: (text, params) => wrap(pg).query(text, params),
    exec: (sql) => wrap(pg).exec(sql),
    transaction: <T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> =>
      pg.transaction(async (tx) => fn(wrap(tx as unknown as PgLiteLike))) as Promise<T>,
    close: () => pg.close(),
  };

  await applyMigrations(db);
  return db;
}
