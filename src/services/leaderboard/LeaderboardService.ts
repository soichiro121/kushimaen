/**
 * Leaderboard reads.
 *
 * Backend-agnostic: the UI asks for a period and gets rows. When the API is
 * unreachable the call falls back to the local board rather than throwing, and the
 * result says which source answered so the UI can label it honestly.
 */
import { apiRequest, ApiError } from '@/services/api/http';
import type {
  LeaderboardPeriod,
  LeaderboardResponse,
  LeaderboardScope,
} from '@/services/api/types';
import { currentBackendMode, demoteToLocalMode } from '@/services/backendMode';
import { localLeaderboard } from './localLeaderboard';

export const LEADERBOARD_PAGE_SIZE = 50;

export interface LeaderboardResult {
  readonly data: LeaderboardResponse | null;
  readonly source: 'remote' | 'local';
  /** Set when the remote board could not be read at all. */
  readonly error: string | null;
}

export const leaderboardService = {
  async fetch(
    period: LeaderboardPeriod,
    options: { runId?: string; limit?: number; scope?: LeaderboardScope } = {},
  ): Promise<LeaderboardResult> {
    const limit = options.limit ?? LEADERBOARD_PAGE_SIZE;
    const scope = options.scope ?? 'total';

    if (currentBackendMode() === 'remote') {
      const query = new URLSearchParams({ period, limit: String(limit), stage: scope });
      if (options.runId) query.set('runId', options.runId);
      try {
        const data = await apiRequest<LeaderboardResponse>(`/leaderboard?${query.toString()}`);
        return { data, source: 'remote', error: null };
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : 'ランキングを取得できませんでした';
        if (error instanceof ApiError && error.isTransient) {
          demoteToLocalMode(message);
          return {
            data: localLeaderboard.fetch(period, limit, options.runId, scope),
            source: 'local',
            error: null,
          };
        }
        return { data: null, source: 'remote', error: message };
      }
    }

    return {
      data: localLeaderboard.fetch(period, limit, options.runId, scope),
      source: 'local',
      error: null,
    };
  },
};
