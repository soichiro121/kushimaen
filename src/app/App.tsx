/**
 * Application shell.
 *
 * Responsibilities:
 *  - render the screen the flow machine asks for,
 *  - keep the Phaser layer mounted underneath it,
 *  - own the lifecycle rules that apply everywhere: pause on background, block
 *    landscape, warm the next stage's assets.
 *
 * It deliberately knows nothing about individual mini-games.
 */
import { useEffect, useMemo, useState } from 'react';
import { GAME_CONFIG } from '@/config/game';
import { audioService } from '@/services/audio/AudioService';
import { pauseGame, resumeGame } from '@/game/core/hostAccess';
import { useRunStore } from '@/stores/runStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Analytics } from '@/services/analytics';
import { GameLayer } from './GameLayer';
import { ErrorBoundary } from './ErrorBoundary';
import { DebugOverlay } from '@/components/dev/DebugOverlay';
import { OrientationGuard } from '@/components/overlays/OrientationGuard';
import { useOrientationBlocked } from '@/utils/useOrientationBlocked';
import { PauseOverlay } from '@/components/overlays/PauseOverlay';
import { ErrorScreen } from '@/components/screens/ErrorScreen';
import { FinalResultScreen } from '@/components/screens/FinalResultScreen';
import { LeaderboardScreen } from '@/components/screens/LeaderboardScreen';
import { LoadingScreen } from '@/components/screens/LoadingScreen';
import { NicknameScreen } from '@/components/screens/NicknameScreen';
import { StageIntroScreen } from '@/components/screens/StageIntroScreen';
import { StageResultScreen } from '@/components/screens/StageResultScreen';
import { TitleScreen } from '@/components/screens/TitleScreen';
import { MaintenanceScreen } from '@/components/screens/MaintenanceScreen';
import type { AssetBundleId } from '@/assets/assetTypes';

export function App() {
  const screen = useRunStore((state) => state.screen);
  const finishBoot = useRunStore((state) => state.finishBoot);
  const retry = useRunStore((state) => state.retry);
  const errorMessage = useRunStore((state) => state.errorMessage);
  const session = useRunStore((state) => state.session);
  const stage = useRunStore((state) => state.currentStage());
  const stages = useRunStore((state) => state.stages());
  const stageIndex = useRunStore((state) => state.stageIndex);
  const applyToServices = useSettingsStore((state) => state.applyToServices);

  const paused = useAppPause(screen === 'stage');
  const orientationBlocked = useOrientationBlocked();

  // Apply persisted audio/vibration settings before anything can make a sound.
  useEffect(() => {
    applyToServices();
  }, [applyToServices]);

  useEffect(() => {
    if (screen === 'boot') finishBoot();
  }, [screen, finishBoot]);

  // Landscape must pause the running game, not just cover it.
  useEffect(() => {
    if (orientationBlocked) pauseGame();
    else if (!paused.isPaused) resumeGame();
  }, [orientationBlocked, paused.isPaused]);

  /**
   * Progressive loading: once the title is reachable, warm the bundles for the
   * stages that come later. Stage 1 was already loaded by the loading screen.
   */
  const preloadBundles = useMemo<readonly AssetBundleId[]>(() => {
    if (screen === 'boot' || screen === 'loading') return [];
    const upcoming = stages.slice(stageIndex + 1);
    const bundles = new Set<AssetBundleId>();
    for (const item of upcoming) for (const bundle of item.bundles) bundles.add(bundle);
    return [...bundles];
  }, [screen, stages, stageIndex]);

  if (GAME_CONFIG.maintenance) return <MaintenanceScreen />;

  const showGameLayer = screen === 'stage';

  return (
    <ErrorBoundary onReset={retry}>
      {/* Mounted from the loading screen onward so background preloading can run. */}
      {screen !== 'boot' ? (
        <GameLayer
          visible={showGameLayer}
          stage={showGameLayer ? stage : null}
          seed={session?.seed ?? 0}
          preloadBundles={preloadBundles}
        />
      ) : null}

      {renderScreen(screen, errorMessage, retry)}

      {orientationBlocked ? <OrientationGuard /> : null}
      {!orientationBlocked && paused.isPaused ? (
        <PauseOverlay canResume={screen === 'stage'} onResume={paused.resume} />
      ) : null}

      <DebugOverlay />
      <Analytics />
    </ErrorBoundary>
  );
}

function renderScreen(
  screen: ReturnType<typeof useRunStore.getState>['screen'],
  errorMessage: string | null,
  retry: () => void,
) {
  switch (screen) {
    case 'boot':
    case 'loading':
      return <LoadingScreen />;
    case 'title':
      return <TitleScreen />;
    case 'nickname':
      return <NicknameScreen />;
    case 'stageIntro':
      return <StageIntroScreen />;
    case 'stage':
      return null; // the Phaser layer is the screen
    case 'stageResult':
      return <StageResultScreen />;
    case 'finalResult':
      return <FinalResultScreen />;
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'error':
      return (
        <ErrorScreen message={errorMessage ?? '不明なエラーが発生しました。'} onRetry={retry} />
      );
  }
}

/**
 * Pauses on `visibilitychange` and `blur`, and requires an explicit tap to resume.
 *
 * Resuming automatically would drop the player back into a running timer after a
 * phone call or a notification, which the spec explicitly forbids.
 */
function useAppPause(isPlaying: boolean): { isPaused: boolean; resume(): void } {
  const [isPaused, setPaused] = useState(false);

  useEffect(() => {
    const pause = (): void => {
      if (document.visibilityState === 'visible' && document.hasFocus()) return;
      pauseGame();
      audioService.suspend();
      // Outside a stage there is no timer to protect, so no overlay is needed.
      if (isPlaying) setPaused(true);
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') pause();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', pause);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', pause);
      window.removeEventListener('pagehide', pause);
    };
  }, [isPlaying]);

  // Leaving a stage clears a stale overlay (e.g. the stage ended while backgrounded).
  useEffect(() => {
    if (!isPlaying && isPaused) setPaused(false);
  }, [isPlaying, isPaused]);

  return {
    isPaused,
    resume: () => {
      setPaused(false);
      audioService.resume();
      resumeGame();
    },
  };
}
