/**
 * Run lifecycle.
 *
 * A "run" is one attempt at the whole three-stage set. The server issues its id,
 * its seed and its expiry, so the client cannot fish for a favourable seed or replay
 * an old run. In LOCAL MODE the same contract is satisfied locally.
 */
import { GAME_CONFIG } from '@/config/game';
import { RULES } from '@/config/rules';
import { apiRequest, ApiError } from '@/services/api/http';
import type {
  CompleteRunRequest,
  CompleteRunResponse,
  CreateRunResponse,
} from '@/services/api/types';
import {
  confirmRemoteMode,
  currentBackendMode,
  demoteToLocalMode,
  shouldAttemptRemote,
  type BackendMode,
} from '@/services/backendMode';
import { createLocalSeed } from '@/utils/rng';
import { localLeaderboard } from '@/services/leaderboard/localLeaderboard';
import { validateSubmission } from './validation';

export interface RunSession {
  readonly runId: string;
  readonly seed: number;
  readonly configVersion: number;
  readonly expiresAt: number;
  readonly startedAt: number;
  readonly mode: BackendMode;
}

export interface RunService {
  createRun(): Promise<RunSession>;
  completeRun(session: RunSession, payload: CompleteRunRequest): Promise<CompleteRunResponse>;
}

// ---------------------------------------------------------------------------

class HttpRunService implements RunService {
  async createRun(): Promise<RunSession> {
    const response = await apiRequest<CreateRunResponse>('/runs', {
      method: 'POST',
      body: { configVersion: GAME_CONFIG.configVersion },
      // Sits on the critical path behind the START button, so it must fail fast
      // enough that an offline player is not left staring at a spinner - but slowly
      // enough to survive a cold backend worker.
      timeoutMs: 4000,
    });
    return {
      runId: response.runId,
      seed: response.seed >>> 0,
      configVersion: response.configVersion,
      expiresAt: Date.parse(response.expiresAt),
      startedAt: Date.now(),
      mode: 'remote',
    };
  }

  async completeRun(
    session: RunSession,
    payload: CompleteRunRequest,
  ): Promise<CompleteRunResponse> {
    return apiRequest<CompleteRunResponse>(`/runs/${encodeURIComponent(session.runId)}/complete`, {
      method: 'POST',
      body: payload,
      timeoutMs: 12000,
    });
  }
}

// ---------------------------------------------------------------------------

/** Unguessable enough that two tabs cannot collide, without pulling in a uuid library. */
function localRunId(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  const buffer = new Uint32Array(2);
  crypto?.getRandomValues?.(buffer);
  return `${Date.now().toString(36)}-${(buffer[0] ?? 0).toString(36)}${(buffer[1] ?? 0).toString(36)}`;
}

class LocalRunService implements RunService {
  async createRun(): Promise<RunSession> {
    const now = Date.now();
    return {
      runId: `local-${localRunId()}`,
      seed: createLocalSeed(),
      configVersion: GAME_CONFIG.configVersion,
      expiresAt: now + RULES.run.ttlSeconds * 1000,
      startedAt: now,
      mode: 'local',
    };
  }

  /**
   * Runs the same validation the server would, then stores the entry locally. This
   * keeps LOCAL MODE honest: a score that production would reject is rejected here
   * too, so balance testing reflects reality.
   */
  async completeRun(
    session: RunSession,
    payload: CompleteRunRequest,
  ): Promise<CompleteRunResponse> {
    if (Date.now() > session.expiresAt) {
      return { accepted: false, totalScore: 0, stageScores: {}, rank: null, notice: 'run expired' };
    }

    const outcome = validateSubmission(payload.stages);
    if (!outcome.valid) {
      console.warn('[local-mode] submission rejected', outcome.issues);
      return {
        accepted: false,
        totalScore: outcome.totalScore,
        stageScores: outcome.stageScores,
        rank: null,
        notice: outcome.issues[0]?.message ?? 'invalid submission',
      };
    }

    const rank = localLeaderboard.insert({
      runId: session.runId,
      nickname: payload.nickname,
      totalScore: outcome.totalScore,
      createdAt: new Date().toISOString(),
    });

    return {
      accepted: true,
      totalScore: outcome.totalScore,
      stageScores: outcome.stageScores,
      rank,
    };
  }
}

// ---------------------------------------------------------------------------

const httpRunService = new HttpRunService();
const localRunService = new LocalRunService();

/**
 * Picks the implementation for the current mode, and transparently falls back to
 * local when a remote call fails. The caller never has to think about it.
 */
export const runService: RunService = {
  /**
   * Opening a run is also the backend's second chance. The health probe on the
   * loading screen can lose to a cold worker or a slow first request, and without a
   * retry here one early timeout would quietly send the entire run to the local
   * leaderboard instead of the real one - with the player never told why.
   */
  async createRun(): Promise<RunSession> {
    if (shouldAttemptRemote()) {
      try {
        const session = await httpRunService.createRun();
        confirmRemoteMode();
        return session;
      } catch (error) {
        demoteToLocalMode(error instanceof ApiError ? error.message : 'createRun failed');
      }
    }
    return localRunService.createRun();
  },

  async completeRun(session, payload): Promise<CompleteRunResponse> {
    if (session.mode === 'remote' && currentBackendMode() === 'remote') {
      try {
        return await httpRunService.completeRun(session, payload);
      } catch (error) {
        // A rejection (4xx) is a real answer and must be shown, not hidden by a retry.
        if (error instanceof ApiError && !error.isTransient) throw error;
        demoteToLocalMode(error instanceof ApiError ? error.message : 'completeRun failed');
      }
    }
    return localRunService.completeRun({ ...session, mode: 'local' }, payload);
  },
};
