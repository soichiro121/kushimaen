/**
 * Leaderboard reads.
 *
 * Ranking lives in the repository (it is a SQL concern); this shapes the response and
 * marks the caller's own row.
 */
import { RULES } from '../../shared/core/rules.js';
import { countValidScores, placementOf, topScores, type Period } from '../repository/scores.js';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardScope,
} from '../../shared/core/api.js';
import type { SqlClient } from '../db/types.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/** Anything that is not exactly `today` is the all-time board. */
export function parsePeriod(value: string | null): Period {
  return value === 'today' ? 'today' : 'all';
}

/**
 * Which board to read.
 *
 * Checked against the rule set's own stage list rather than a literal, so a fourth
 * mini-game gets a board by being declared - and so an arbitrary string from the
 * query cannot become one. The value does reach SQL (bound, never concatenated), and
 * anything unrecognised falls back to the combined board rather than erroring: a
 * stale link is not worth a 400.
 */
export function parseScope(value: string | null): LeaderboardScope {
  if (value === null || value === 'total') return 'total';
  return RULES.stageOrder.find((id) => id === value) ?? 'total';
}

export function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

export async function board(
  db: SqlClient,
  now: Date,
  scope: LeaderboardScope,
  period: Period,
  limit: number,
  runId: string | null,
): Promise<LeaderboardResponse> {
  const version = RULES.configVersion;

  const rows = await topScores(db, version, scope, period, limit, now);
  const entries: LeaderboardEntry[] = rows.map((row) => ({
    rank: row.rank,
    nickname: row.nickname,
    score: row.score,
    createdAt: row.createdAt,
    isMe: runId !== null && row.runId === runId,
  }));

  let me: LeaderboardEntry | null = null;
  if (runId !== null) {
    const placement = await placementOf(db, version, runId, scope, period, now);
    if (placement !== null) {
      me = {
        rank: placement.rank,
        nickname: placement.nickname,
        score: placement.score,
        createdAt: placement.createdAt,
        isMe: true,
      };
    }
  }

  return {
    period,
    scope,
    entries,
    me,
    total: await countValidScores(db, version, scope, period, now),
  };
}
