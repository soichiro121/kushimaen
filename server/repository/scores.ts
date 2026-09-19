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
import type { SqlClient } from '../db/types.js';
import { CONFIG } from '../config/env.js';
import type { LeaderboardScope } from '../../shared/core/api.js';

export interface ScoreRow {
  rank: number;
  runId: string;
  nickname: string;
  score: number;
  createdAt: string;
}

export type Period = 'today' | 'all';

interface DbRow {
  run_id: string;
  nickname: string;
  score: number | string;
  created_at: Date | string;
}

/**
 * Collects bound values and hands back the placeholder for each.
 *
 * The three board queries below are assembled from fragments, and hand-numbering
 * `$1`, `$2`, ... across fragments is exactly the kind of bookkeeping that ends with
 * a value bound to the wrong slot. Only ever placeholders are interpolated into SQL;
 * every value goes through `bind`.
 */
class Bindings {
  readonly values: unknown[] = [];

  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Where a board reads its rows from, and which column it ranks.
 *
 * ONE definition for both shapes of board. The list, the caller's placement and the
 * total have to agree about what counts and how ties break - if they drift, a player
 * is told they are 7th while standing at position 8 in the list they are reading.
 */
interface Board {
  /** FROM clause. `s` is always the `scores` row, whichever shape this is. */
  readonly from: string;
  /** The ranked expression. */
  readonly score: string;
  readonly where: string;
}

function board(scope: LeaderboardScope, configVersion: number, bindings: Bindings): Board {
  const version = bindings.bind(configVersion);

  if (scope === 'total') {
    return {
      from: 'scores s',
      score: 's.total_score',
      where: `s.valid = 1 AND s.config_version = ${version}`,
    };
  }

  // A stage board joins back to `scores` for the nickname, the timestamp and - the
  // part that matters - `valid` and `config_version`. A stage row from a rejected
  // run must not appear just because it is stored in a different table.
  const stage = bindings.bind(scope);
  return {
    from: 'stage_results sr JOIN scores s ON s.run_id = sr.run_id',
    score: 'sr.score',
    where: `s.valid = 1 AND s.config_version = ${version} AND sr.stage_id = ${stage}`,
  };
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
 * Restricts a board to the current local day.
 *
 * Qualified as `s.created_at` because a stage board joins two tables, and an
 * unqualified `created_at` would be ambiguous the moment one gained the column.
 */
function periodFilter(period: Period, now: Date, bindings: Bindings): string {
  if (period !== 'today') return '';
  return ` AND s.created_at >= ${bindings.bind(startOfLocalDay(now))}`;
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
 * Top entries for a board.
 *
 * Ties are broken by the earlier submission, so a rank never changes underneath a
 * player who is already on the board.
 */
export async function topScores(
  db: SqlClient,
  configVersion: number,
  scope: LeaderboardScope,
  period: Period,
  limit: number,
  now: Date,
): Promise<ScoreRow[]> {
  const bindings = new Bindings();
  const { from, score, where } = board(scope, configVersion, bindings);
  const day = periodFilter(period, now, bindings);
  const safeLimit = bindings.bind(Math.max(1, Math.min(Math.trunc(limit), 200)));

  const { rows } = await db.query<DbRow>(
    `SELECT s.run_id, s.nickname, ${score} AS score, s.created_at
     FROM ${from}
     WHERE ${where}${day}
     ORDER BY ${score} DESC, s.created_at ASC
     LIMIT ${safeLimit}`,
    bindings.values,
  );

  return rows.map((row, index) => ({
    rank: index + 1,
    runId: row.run_id,
    nickname: row.nickname,
    score: Number(row.score),
    createdAt: toIso(row.created_at),
  }));
}

/**
 * One run's placement on a board, even when it is outside the returned page.
 *
 * Returns null when the run has no row on this board at all - which on a stage
 * board includes a run that simply never played that stage.
 */
export async function placementOf(
  db: SqlClient,
  configVersion: number,
  runId: string,
  scope: LeaderboardScope,
  period: Period,
  now: Date,
): Promise<ScoreRow | null> {
  const mineBindings = new Bindings();
  const mineBoard = board(scope, configVersion, mineBindings);
  const { rows } = await db.query<DbRow>(
    `SELECT s.run_id, s.nickname, ${mineBoard.score} AS score, s.created_at
     FROM ${mineBoard.from}
     WHERE ${mineBoard.where} AND s.run_id = ${mineBindings.bind(runId)}`,
    mineBindings.values,
  );
  const mine = rows[0];
  if (mine === undefined) return null;

  const bindings = new Bindings();
  const { from, score, where } = board(scope, configVersion, bindings);
  const day = periodFilter(period, now, bindings);
  const mineScore = bindings.bind(Number(mine.score));
  const mineAt = bindings.bind(mine.created_at);

  // Rank = (how many entries beat it) + 1, with the same tie-break as `topScores`.
  const { rows: ahead } = await db.query<{ ahead: number | string }>(
    `SELECT COUNT(*) AS ahead
     FROM ${from}
     WHERE ${where}${day}
       AND (${score} > ${mineScore} OR (${score} = ${mineScore} AND s.created_at < ${mineAt}))`,
    bindings.values,
  );

  return {
    rank: Number(ahead[0]?.ahead ?? 0) + 1,
    runId: mine.run_id,
    nickname: mine.nickname,
    score: Number(mine.score),
    createdAt: toIso(mine.created_at),
  };
}

export async function countValidScores(
  db: SqlClient,
  configVersion: number,
  scope: LeaderboardScope,
  period: Period,
  now: Date,
): Promise<number> {
  const bindings = new Bindings();
  const { from, where } = board(scope, configVersion, bindings);
  const day = periodFilter(period, now, bindings);

  const { rows } = await db.query<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM ${from} WHERE ${where}${day}`,
    bindings.values,
  );
  return Number(rows[0]?.total ?? 0);
}
