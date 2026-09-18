/**
 * Applies pending database migrations.
 *
 *   npm run db:migrate
 *
 * Point `DATABASE_URL` at the target database. This is how the production schema
 * changes - never by hand, and never from a request.
 *
 * BUILD/OPS TOOL. It is not part of the deployed bundle.
 */
import { createNeonDatabase } from '../server/db/neon';
import { applyMigrations } from '../server/db/migrate';

const db = createNeonDatabase();
try {
  const applied = await applyMigrations(db);
  if (applied.length === 0) {
    console.info('[db:migrate] already up to date');
  } else {
    for (const name of applied) console.info(`[db:migrate] applied ${name}`);
  }
} finally {
  await db.close();
}
