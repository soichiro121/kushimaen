/**
 * Backend availability.
 *
 * The game must be fully playable with no backend at all: a developer with only
 * `npm run dev` running, or a player whose network drops mid-session. When the API
 * cannot be reached the app switches to LOCAL MODE and keeps a leaderboard in
 * localStorage. Nothing else in the app branches on this - the services do.
 *
 * Sticky in one direction only. A successful probe is cached for the session, but a
 * FAILED probe is only cached briefly: a single slow first request (a cold PHP
 * worker, a school Wi-Fi hiccup) must not silently strand the whole session in local
 * mode, because the player would then finish a run whose score never reaches the
 * real leaderboard and never be told why.
 */
import { apiRequest, ApiError } from './api/http';
import type { HealthResponse } from './api/types';

export type BackendMode = 'remote' | 'local';

let resolved: BackendMode | null = null;
/** When the last failed probe happened, so a retry is allowed after a short wait. */
let lastFailureAt = 0;
let probe: Promise<BackendMode> | null = null;

/**
 * Generous enough to survive a cold backend, short enough that it loses to asset
 * loading rather than delaying the title screen (the two run in parallel).
 */
const PROBE_TIMEOUT_MS = 5000;

/** How long a failure is trusted before the next call is allowed to probe again. */
const FAILURE_TTL_MS = 4000;

export function currentBackendMode(): BackendMode {
  return resolved ?? 'local';
}

export function isBackendResolved(): boolean {
  return resolved !== null;
}

/**
 * Whether a remote call is worth attempting.
 *
 * True when the backend is known good, when it has never been probed, or when the
 * last failure is stale. This is what lets `createRun` retry after an early probe
 * timeout WITHOUT paying for a second round trip: the run creation is itself the
 * retry, so the player waits for one request rather than two.
 */
export function shouldAttemptRemote(): boolean {
  if (resolved === 'remote') return true;
  if (resolved === null) return true;
  return Date.now() - lastFailureAt >= FAILURE_TTL_MS;
}

/** Called when a remote call succeeded, confirming the backend is reachable. */
export function confirmRemoteMode(): void {
  resolved = 'remote';
}

/**
 * Resolves the backend mode, re-probing after a stale failure.
 *
 * @param force probe again even if a recent failure is cached (used when a run is
 *              about to start, which is the last moment a retry is still useful).
 */
export async function detectBackendMode(force = false): Promise<BackendMode> {
  // A confirmed backend never needs re-checking; individual calls fall back on error.
  if (resolved === 'remote') return 'remote';
  if (probe) return probe;

  const failureIsFresh = Date.now() - lastFailureAt < FAILURE_TTL_MS;
  if (resolved === 'local' && !force && failureIsFresh) return 'local';

  probe = (async (): Promise<BackendMode> => {
    try {
      const health = await apiRequest<HealthResponse>('/health', {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (health?.status === 'ok') {
        resolved = 'remote';
        return 'remote';
      }
      resolved = 'local';
      lastFailureAt = Date.now();
      console.info('[backend] LOCAL MODE: /api/health did not report ok');
    } catch (error) {
      resolved = 'local';
      lastFailureAt = Date.now();
      if (error instanceof ApiError) {
        console.info(`[backend] LOCAL MODE (${error.code}): ${error.message}`);
      }
    } finally {
      probe = null;
    }
    return 'local';
  })();

  return probe;
}

/**
 * Drops back to local mode after a remote call fails hard, so a mid-run outage does
 * not leave the player staring at an error. The next `detectBackendMode` may probe
 * again, which is what lets a brief outage recover on its own.
 */
export function demoteToLocalMode(reason: string): void {
  if (resolved === 'local') return;
  console.warn(`[backend] falling back to LOCAL MODE: ${reason}`);
  resolved = 'local';
  lastFailureAt = Date.now();
}

/** Test seam. */
export function resetBackendMode(mode: BackendMode | null = null): void {
  resolved = mode;
  lastFailureAt = 0;
  probe = null;
}
