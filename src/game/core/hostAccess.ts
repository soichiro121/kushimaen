/**
 * Process-wide access to the live `GameHost`.
 *
 * `GameLayer` owns the instance; screens and app-level handlers (visibility change,
 * orientation, the loading screen's progress bar) need to reach it without a React
 * context threaded through every component. Every accessor is a no-op when no host
 * exists yet, so nothing has to guard the call.
 */
import type { AssetBundleId } from '@/assets/assetTypes';
import type { GameHost } from './GameHost';

let activeHost: GameHost | null = null;

export function setActiveHost(host: GameHost | null): void {
  activeHost = host;
}

export function hasActiveHost(): boolean {
  return activeHost !== null;
}

export function pauseGame(): void {
  activeHost?.pause();
}

export function resumeGame(): void {
  activeHost?.resume();
}

/** Resolves immediately (with progress 1) when there is no host to load through. */
export async function preloadBundles(
  bundles: readonly AssetBundleId[],
  onProgress?: (ratio: number) => void,
): Promise<void> {
  if (!activeHost) {
    onProgress?.(1);
    return;
  }
  await activeHost.preload(bundles, onProgress);
}
