/**
 * Debug-only state (`?debug=1`).
 *
 * Kept out of the gameplay stores so nothing in the production path depends on it,
 * and updated at most a few times a second by the stage's debug snapshot.
 */
import { create } from 'zustand';
import type { StageDebugSnapshot } from '@/game/core/stageTypes';

interface DebugState {
  snapshot: StageDebugSnapshot | null;
  fps: number;
  setSnapshot(snapshot: StageDebugSnapshot): void;
  setFps(fps: number): void;
}

export const useDebugStore = create<DebugState>((set) => ({
  snapshot: null,
  fps: 0,
  setSnapshot: (snapshot) => set({ snapshot }),
  setFps: (fps) => set({ fps }),
}));
