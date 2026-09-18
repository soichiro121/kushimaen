/**
 * Persistence for runs.
 *
 * Every statement is parameterised: the SQL strings below are literals and every
 * value travels in the params array. Nothing concatenates user input.
 */
import { RUN_STATUS, type Run, type RunStatus } from '../domain/run';
import type { SqlClient } from '../db/types';

interface RunRow {
  id: string;
  seed: string | number;
  config_version: number;
  started_at: Date | string;
  expires_at: Date | string;
  completed_at: Date | string | null;
  status: string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value.replace(' ', 'T')}Z`);
}

function hydrate(row: RunRow): Run {
  return {
    id: row.id,
    seed: Number(row.seed),
    configVersion: Number(row.config_version),
    startedAt: toDate(row.started_at),
    expiresAt: toDate(row.expires_at),
    completedAt: row.completed_at === null ? null : toDate(row.completed_at),
    status: row.status as RunStatus,
  };
}

export async function insertRun(db: SqlClient, run: Run): Promise<void> {
  await db.query(
    `INSERT INTO runs (id, seed, config_version, started_at, expires_at, completed_at, status)
     VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
    [run.id, run.seed, run.configVersion, run.startedAt, run.expiresAt, run.status],
  );
}

export async function findRun(db: SqlClient, runId: string): Promise<Run | null> {
  const { rows } = await db.query<RunRow>(
    `SELECT id, seed, config_version, started_at, expires_at, completed_at, status
     FROM runs WHERE id = $1`,
    [runId],
  );
  const row = rows[0];
  return row === undefined ? null : hydrate(row);
}

/**
 * Closes a run, returning whether THIS call is the one that claimed it.
 *
 * The `status = 'open'` predicate is what makes a duplicate submission impossible:
 * the second request updates zero rows and is rejected, even if two arrive at the
 * same instant. That is a database-level guarantee, not a check-then-act race.
 */
export async function markRunCompleted(
  db: SqlClient,
  runId: string,
  completedAt: Date,
  status: RunStatus,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE runs SET completed_at = $1, status = $2
     WHERE id = $3 AND status = $4`,
    [completedAt, status, runId, RUN_STATUS.open],
  );
  return rowCount === 1;
}

/** Housekeeping: drops abandoned runs so the table does not grow without bound. */
export async function deleteExpiredRunsBefore(db: SqlClient, cutoff: Date): Promise<number> {
  const { rowCount } = await db.query('DELETE FROM runs WHERE status = $1 AND expires_at < $2', [
    RUN_STATUS.open,
    cutoff,
  ]);
  return rowCount;
}
