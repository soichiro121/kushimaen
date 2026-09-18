/**
 * Leaderboard reads.
 *
 * Ranking lives in the repository (it is a SQL concern); this shapes the response and
 * marks the caller's own row.
 */
import { RULES } from '../../shared/core/rules';
import { countValidScores, placementOf, topScores, type Period } from '../repository/scores';
import type { LeaderboardEntry, LeaderboardResponse } from '../../shared/core/api';
import type { SqlClient } from '../db/types';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/** Anything that is not exactly `today` is the all-time board. */
export function parsePeriod(value: string | null): Period {
  return value === 'today' ? 'today' : 'all';
}

export function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

export async function board(
  db: SqlClient,
  now: Date,
  period: Period,
  limit: number,
  runId: string | null,
): Promise<LeaderboardResponse> {
  const version = RULES.configVersion;

  const rows = await topScores(db, version, period, limit, now);
  const entries: LeaderboardEntry[] = rows.map((row) => ({
    rank: row.rank,
    nickname: row.nickname,
    totalScore: row.totalScore,
    createdAt: row.createdAt,
    isMe: runId !== null && row.runId === runId,
  }));

  let me: LeaderboardEntry | null = null;
  if (runId !== null) {
    const placement = await placementOf(db, version, runId, period, now);
    if (placement !== null) {
      me = {
        rank: placement.rank,
        nickname: placement.nickname,
        totalScore: placement.totalScore,
        createdAt: placement.createdAt,
        isMe: true,
      };
    }
  }

  return { period, entries, me, total: await countValidScores(db, version, period, now) };
}
