/**
 * LOCAL MODE leaderboard, backed by localStorage.
 *
 * Exists so the game is fully playable and testable with no API reachable.
 * It is explicitly NOT a security boundary - it is a development convenience, and
 * the UI labels it as local.
 */
import { readJson, writeJson } from '@/services/storage/localStore';
import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardResponse,
  LeaderboardScope,
} from '@/services/api/types';

const STORAGE_KEY = 'leaderboard';
const MAX_STORED_ENTRIES = 500;

interface StoredEntry {
  runId: string;
  nickname: string;
  totalScore: number;
  createdAt: string;
  /**
   * Per-stage scores, for the stage boards.
   *
   * Optional because entries saved before stage boards existed do not have it.
   * Those stay on the combined board and are simply absent from the stage ones -
   * dropping them outright would wipe a player's local history for a feature they
   * did not ask for.
   */
  stageScores?: Record<string, number>;
}

function isScoreMap(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function validate(value: unknown): StoredEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is StoredEntry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.runId === 'string' &&
      typeof record.nickname === 'string' &&
      typeof record.totalScore === 'number' &&
      Number.isFinite(record.totalScore) &&
      typeof record.createdAt === 'string' &&
      (record.stageScores === undefined || isScoreMap(record.stageScores))
    );
  });
}

function load(): StoredEntry[] {
  return readJson<StoredEntry[]>(STORAGE_KEY, validate, []);
}

function save(entries: StoredEntry[]): void {
  writeJson(STORAGE_KEY, entries.slice(0, MAX_STORED_ENTRIES));
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * The score a given board ranks an entry by, or null when the entry does not belong
 * on it at all - a run that never played that stage, or one saved before the stage
 * scores were recorded.
 */
function scoreFor(entry: StoredEntry, scope: LeaderboardScope): number | null {
  if (scope === 'total') return entry.totalScore;
  const score = entry.stageScores?.[scope];
  return typeof score === 'number' ? score : null;
}

interface Ranked {
  entry: StoredEntry;
  score: number;
}

/** The whole board for one scope, ordered, with the same tie-break as the server. */
function ranked(scope: LeaderboardScope, period: LeaderboardPeriod): Ranked[] {
  return load()
    .filter((entry) => period === 'all' || isToday(entry.createdAt))
    .flatMap((entry) => {
      const score = scoreFor(entry, scope);
      return score === null ? [] : [{ entry, score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score || Date.parse(a.entry.createdAt) - Date.parse(b.entry.createdAt),
    );
}

export const localLeaderboard = {
  /** Stores an entry and returns its all-time rank on the combined board (1-based). */
  insert(entry: StoredEntry): number {
    const entries = load().filter((existing) => existing.runId !== entry.runId);
    entries.push(entry);
    save(
      entries.sort(
        (a, b) => b.totalScore - a.totalScore || Date.parse(a.createdAt) - Date.parse(b.createdAt),
      ),
    );
    return ranked('total', 'all').findIndex((row) => row.entry.runId === entry.runId) + 1;
  },

  fetch(
    period: LeaderboardPeriod,
    limit: number,
    runId?: string,
    scope: LeaderboardScope = 'total',
  ): LeaderboardResponse {
    const pool = ranked(scope, period);

    const toEntry = (row: Ranked, index: number): LeaderboardEntry => ({
      rank: index + 1,
      nickname: row.entry.nickname,
      score: row.score,
      createdAt: row.entry.createdAt,
      isMe: runId !== undefined && row.entry.runId === runId,
    });

    const myIndex = runId ? pool.findIndex((row) => row.entry.runId === runId) : -1;
    const mine = myIndex >= 0 ? toEntry(pool[myIndex] as Ranked, myIndex) : null;

    return {
      period,
      scope,
      entries: pool.slice(0, limit).map(toEntry),
      me: mine,
      total: pool.length,
    };
  },

  clear(): void {
    save([]);
  },
};
