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
} from '@/services/api/types';

const STORAGE_KEY = 'leaderboard';
const MAX_STORED_ENTRIES = 500;

interface StoredEntry {
  runId: string;
  nickname: string;
  totalScore: number;
  createdAt: string;
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
      typeof record.createdAt === 'string'
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

function sorted(entries: StoredEntry[]): StoredEntry[] {
  return [...entries].sort(
    (a, b) => b.totalScore - a.totalScore || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

export const localLeaderboard = {
  /** Stores an entry and returns its all-time rank (1-based). */
  insert(entry: StoredEntry): number {
    const entries = load().filter((existing) => existing.runId !== entry.runId);
    entries.push(entry);
    const ordered = sorted(entries);
    save(ordered);
    return ordered.findIndex((candidate) => candidate.runId === entry.runId) + 1;
  },

  fetch(period: LeaderboardPeriod, limit: number, runId?: string): LeaderboardResponse {
    const pool = sorted(load().filter((entry) => period === 'all' || isToday(entry.createdAt)));

    const toEntry = (entry: StoredEntry, index: number): LeaderboardEntry => ({
      rank: index + 1,
      nickname: entry.nickname,
      totalScore: entry.totalScore,
      createdAt: entry.createdAt,
      isMe: runId !== undefined && entry.runId === runId,
    });

    const myIndex = runId ? pool.findIndex((entry) => entry.runId === runId) : -1;
    const mine = myIndex >= 0 ? toEntry(pool[myIndex] as StoredEntry, myIndex) : null;

    return {
      period,
      entries: pool.slice(0, limit).map(toEntry),
      me: mine,
      total: pool.length,
    };
  },

  clear(): void {
    save([]);
  },
};
