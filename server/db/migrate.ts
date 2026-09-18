/**
 * Migration runner.
 *
 * Schema changes are files in `server/db/migrations/`, applied in filename order and
 * recorded in a `schema_migrations` table so each one runs exactly once.
 *
 * THE RULE THIS ENFORCES: the production database is never edited by hand. To change
 * the schema you add a numbered file and run this; that way every environment gets
 * the same change in the same order, and what happened is in version control.
 *
 * Run it with `npm run db:migrate` (see docs/DEPLOYMENT.md). It is NOT a route - a
 * request must never be able to alter the schema.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './types.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export function loadMigrations(directory = MIGRATIONS_DIR): Migration[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort() // filenames are zero-padded, so lexical order IS apply order
    .map((name) => ({ name, sql: readFileSync(join(directory, name), 'utf8') }));
}

/**
 * Applies every migration that has not run yet.
 *
 * @returns the names actually applied, so a deploy log shows what changed.
 */
export async function applyMigrations(
  db: Database,
  migrations: readonly Migration[] = loadMigrations(),
): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((row) => row.name));

  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.name)) continue;
    // Each migration is its own transaction: one bad file cannot leave the schema
    // half-changed, and the ones before it stay applied.
    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    });
    applied.push(migration.name);
  }
  return applied;
}
