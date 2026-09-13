/**
 * The app flow machine.
 *
 *   boot -> loading -> title -> nickname -> [stageIntro -> stage -> stageResult] x N
 *        -> finalResult -> leaderboard
 *
 * Stages are addressed by index into `playableStages()`, never by name, so adding or
 * disabling a mini-game changes nothing here.
 */
import { create } from 'zustand';
import { playableStages } from '@/game/stages';
import type { StageModule, StageResult } from '@/game/core/stageTypes';
import { runService, type RunSession } from '@/services/run/RunService';
import type { CompleteRunResponse } from '@/services/api/types';
import { ApiError } from '@/services/api/http';
import { GAME_CONFIG } from '@/config/game';
import { useSettingsStore } from './settingsStore';

export type Screen =
  | 'boot'
  | 'loading'
  | 'title'
  | 'nickname'
  | 'stageIntro'
  | 'stage'
  | 'stageResult'
  | 'finalResult'
  | 'leaderboard'
  | 'error';

export type SubmissionStatus = 'idle' | 'pending' | 'done' | 'failed';

interface RunState {
  screen: Screen;
  session: RunSession | null;
  stageIndex: number;
  results: StageResult[];
  submissionStatus: SubmissionStatus;
  submissionResponse: CompleteRunResponse | null;
  submissionError: string | null;
  errorMessage: string | null;
  /** True while an overlay (pause / orientation) is blocking play. */
  paused: boolean;

  stages(): readonly StageModule[];
  currentStage(): StageModule | null;
  clientTotalScore(): number;

  finishBoot(): void;
  goToTitle(): void;
  requestStart(): void;
  submitNickname(nickname: string): void;
  beginStage(): void;
  completeStage(result: StageResult): void;
  advanceAfterStageResult(): void;
  showLeaderboard(): void;
  retry(): void;
  setPaused(paused: boolean): void;
  fail(message: string): void;
  /** DEV ONLY: jump straight into one stage from /dev. */
  startDevStage(index: number): Promise<void>;
}

export const useRunStore = create<RunState>((set, get) => ({
  screen: 'boot',
  session: null,
  stageIndex: 0,
  results: [],
  submissionStatus: 'idle',
  submissionResponse: null,
  submissionError: null,
  errorMessage: null,
  paused: false,

  stages: () => playableStages(),

  currentStage() {
    return get().stages()[get().stageIndex] ?? null;
  },

  clientTotalScore() {
    return get().results.reduce((sum, result) => sum + result.score, 0);
  },

  finishBoot() {
    set({ screen: 'loading' });
  },

  goToTitle() {
    // Only the loading phase may hand over to the title. Without this guard the
    // loader's async completion could overwrite a screen the app already advanced to.
    const { screen } = get();
    if (screen !== 'boot' && screen !== 'loading') return;
    set({ screen: 'title' });
  },

  /** START on the title screen: ask for a nickname the first time, then open a run. */
  requestStart() {
    const nickname = useSettingsStore.getState().nickname;
    if (!nickname) {
      set({ screen: 'nickname' });
      return;
    }
    void openRun(set, get);
  },

  submitNickname(nickname: string) {
    useSettingsStore.getState().setNickname(nickname);
    void openRun(set, get);
  },

  beginStage() {
    set({ screen: 'stage', paused: false });
  },

  completeStage(result: StageResult) {
    const results = [...get().results, result];
    set({ results, screen: 'stageResult' });
  },

  advanceAfterStageResult() {
    const { stageIndex, stages } = get();
    const nextIndex = stageIndex + 1;
    if (nextIndex < stages().length) {
      set({ stageIndex: nextIndex, screen: 'stageIntro' });
      return;
    }
    set({ screen: 'finalResult' });
    void submitRun(set, get);
  },

  showLeaderboard() {
    set({ screen: 'leaderboard' });
  },

  /** RETRY: a brand-new run (new id, new seed) rather than a replay of the old one. */
  retry() {
    set({
      screen: 'title',
      session: null,
      stageIndex: 0,
      results: [],
      submissionStatus: 'idle',
      submissionResponse: null,
      submissionError: null,
      errorMessage: null,
      paused: false,
    });
  },

  setPaused(paused: boolean) {
    set({ paused });
  },

  fail(message: string) {
    set({ screen: 'error', errorMessage: message });
  },

  async startDevStage(index: number) {
    if (!GAME_CONFIG.devToolsAvailable) return;
    const session = await runService.createRun();
    set({
      session,
      stageIndex: Math.max(0, index),
      results: [],
      submissionStatus: 'idle',
      submissionResponse: null,
      submissionError: null,
      errorMessage: null,
      screen: 'stageIntro',
    });
  },
}));

type Setter = (partial: Partial<RunState>) => void;
type Getter = () => RunState;

async function openRun(set: Setter, get: Getter): Promise<void> {
  try {
    const session = await runService.createRun();
    set({
      session,
      stageIndex: 0,
      results: [],
      submissionStatus: 'idle',
      submissionResponse: null,
      submissionError: null,
      screen: 'stageIntro',
    });
  } catch (error) {
    // createRun already falls back to local mode, so reaching here is exceptional.
    get().fail(
      error instanceof ApiError
        ? error.message
        : 'ゲームを開始できませんでした。もう一度お試しください。',
    );
  }
}

async function submitRun(set: Setter, get: Getter): Promise<void> {
  const { session, results } = get();
  if (!session || results.length === 0) return;

  set({ submissionStatus: 'pending', submissionError: null });

  try {
    const response = await runService.completeRun(session, {
      nickname: useSettingsStore.getState().nickname,
      stages: results.map((result) => ({
        stageId: result.stageId,
        score: result.score,
        durationMs: Math.round(result.durationMs),
        metrics: { ...result.metrics },
      })),
      totalScore: get().clientTotalScore(),
    });
    set({
      submissionStatus: response.accepted ? 'done' : 'failed',
      submissionResponse: response,
      submissionError: response.accepted
        ? null
        : (response.notice ?? 'スコアが登録されませんでした'),
    });
  } catch (error) {
    set({
      submissionStatus: 'failed',
      submissionError: error instanceof ApiError ? error.message : 'スコアの登録に失敗しました',
    });
  }
}

/** Re-runs a failed submission from the final result screen. */
export function retrySubmission(): void {
  const store = useRunStore;
  void submitRun(store.setState, store.getState);
}
