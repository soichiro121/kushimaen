/**
 * Leaderboard persistence and ranking.
 *
 * Only rows with `valid = 1` are ever shown. Suspicious submissions are still stored
 * (with their suspicion score) so abuse can be reviewed later rather than vanishing.
 *
 * Every query is scoped to a `config_version`: scores played under different balance
 * rules are not comparable, so each generation gets its own board instead of old
 * inflated totals sitting permanently on top.
 */
import type { SqlClient } from '../db/types';
import { CONFIG } from '../config/env';

export interface ScoreRow {
  rank: number;
  runId: string;
  nickname: string;
  totalScore: number;
  createdAt: string;
}

export type Period = 'today' | 'all';

interface DbRow {
  run_id: string;
  nickname: string;
  total_score: number | string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(`${value.replace(' ', 'T')}Z`)).toISOString();
}

/**
 * Start of the operator's local day, in UTC.
 *
 * "Today" on the daily board means the school day in `APP_TIMEZONE`, not UTC
 * midnight - otherwise the board would roll over at 9am in Japan.
 */
export function startOfLocalDay(now: Date, timeZone = CONFIG.timezone()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  // The offset is derived rather than hard-coded, so this stays correct across DST
  // for any timezone the operator picks.
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000;

  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offsetMs);
}

/**
 * Builds the period predicate. The SQL fragment is a fixed string; the only value
 * involved is bound as a parameter.
 */
function periodFilter(period: Period, now: Date, nextParam: number): [string, unknown[]] {
  if (period !== 'today') return ['', []];
  return [` AND created_at >= $${nextParam}`, [startOfLocalDay(now)]];
}

export async function insertScore(
  db: SqlClient,
  entry: {
    runId: string;
    nickname: string;
    totalScore: number;
    createdAt: Date;
    valid: boolean;
    suspicionScore: number;
    configVersion: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO scores
       (run_id, nickname, total_score, created_at, valid, suspicion_score, config_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.runId,
      entry.nickname,
      entry.totalScore,
      entry.createdAt,
      entry.valid ? 1 : 0,
      entry.suspicionScore,
      entry.configVersion,
    ],
  );
}

/**
 * Top entries for a period.
 *
 * Ties are broken by the earlier submission, so a rank never changes underneath a
 * player who is already on the board.
 */
export async function topScores(
  db: SqlClient,
  configVersion: number,
  period: Period,
  limit: number,
  now: Date,
): Promise<ScoreRow[]> {
  const [where, extra] = periodFilter(period, now, 3);
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 200));

  const { rows } = await db.query<DbRow>(
    `SELECT run_id, nickname, total_score, created_at
     FROM scores
     WHERE valid = 1 AND config_version = $1${where}
     ORDER BY total_score DESC, created_at ASC
     LIMIT $2`,
    [configVersion, safeLimit, ...extra],
  );

  return rows.map((row, index) => ({
    rank: index + 1,
    runId: row.run_id,
    nickname: row.nickname,
    totalScore: Number(row.total_score),
    createdAt: toIso(row.created_at),
  }));
}

/** One run's placement, even when it is outside the returned page. */
export async function placementOf(
  db: SqlClient,
  configVersion: number,
  runId: string,
  period: Period,
  now: Date,
): Promise<ScoreRow | null> {
  const { rows } = await db.query<DbRow>(
    `SELECT run_id, nickname, total_score, created_at
     FROM scores WHERE run_id = $1 AND valid = 1`,
    [runId],
  );
  const mine = rows[0];
  if (mine === undefined) return null;

  const [where, extra] = periodFilter(period, now, 4);
  // Rank = (how many entries beat it) + 1, with the same tie-break as `topScores`.
  const { rows: ahead } = await db.query<{ ahead: number | string }>(
    `SELECT COUNT(*) AS ahead FROM scores
     WHERE valid = 1 AND config_version = $1${where}
       AND (total_score > $2 OR (total_score = $2 AND created_at < $3))`,
    [configVersion, Number(mine.total_score), mine.created_at, ...extra],
  );

  return {
    rank: Number(ahead[0]?.ahead ?? 0) + 1,
    runId: mine.run_id,
    nickname: mine.nickname,
    totalScore: Number(mine.total_score),
    createdAt: toIso(mine.created_at),
  };
}

export async function countValidScores(
  db: SqlClient,
  configVersion: number,
  period: Period,
  now: Date,
): Promise<number> {
  const [where, extra] = periodFilter(period, now, 2);
  const { rows } = await db.query<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM scores
     WHERE valid = 1 AND config_version = $1${where}`,
    [configVersion, ...extra],
  );
  return Number(rows[0]?.total ?? 0);
}
