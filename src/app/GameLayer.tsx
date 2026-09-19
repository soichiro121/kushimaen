/**
 * Hosts the single Phaser instance for the whole session.
 *
 * It is mounted once and stays mounted: creating and destroying Phaser between
 * stages would throw away every loaded texture and stall the transition. The layer
 * is simply hidden when a React screen is in front.
 *
 * This is also the only place that constructs a `StageContext`, so every stage gets
 * its seed, services and completion callback wired the same way.
 */
import { useEffect, useRef } from 'react';
import { GameHost } from '@/game/core/GameHost';
import { setActiveHost } from '@/game/core/hostAccess';
import type { StageContext, StageDebugSnapshot, StageModule } from '@/game/core/stageTypes';
import { createRng, deriveSeed } from '@/utils/rng';
import { audioService } from '@/services/audio/AudioService';
import { vibrate } from '@/services/haptics/haptics';
import { trackEvent } from '@/services/analytics';
import { GAME_CONFIG } from '@/config/game';
import { useRunStore } from '@/stores/runStore';
import { useDebugStore } from '@/stores/debugStore';
import styles from './GameLayer.module.css';

interface GameLayerProps {
  visible: boolean;
  /** The stage to run, or null to keep the canvas idle. */
  stage: StageModule | null;
  seed: number;
  /** Bundles to warm in the background while the player is elsewhere. */
  preloadBundles: readonly string[];
}

export function GameLayer({ visible, stage, seed, preloadBundles }: GameLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<GameHost | null>(null);

  const completeStage = useRunStore((state) => state.completeStage);
  const fail = useRunStore((state) => state.fail);
  const setDebugSnapshot = useDebugStore((state) => state.setSnapshot);

  // -- create the host once -------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || hostRef.current) return;
    hostRef.current = GameHost.create(container);
    setActiveHost(hostRef.current);
    return () => {
      hostRef.current?.destroy();
      hostRef.current = null;
      setActiveHost(null);
    };
  }, []);

  // -- background preloading ------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host || preloadBundles.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const bundle of preloadBundles) {
        if (cancelled) return;
        await host.preload([bundle as 'common' | 'late' | 'bread' | 'teacher']);
        await audioService.preloadBundle(bundle as 'common' | 'late' | 'bread' | 'teacher');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preloadBundles]);

  // -- run the requested stage ---------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (!stage) {
      host.stopCurrentStage();
      return;
    }

    // No "already running" guard: `startStage` replaces whatever scene is active, and
    // the dependency list only changes when the stage or the seed genuinely changes.
    // A guard here would deadlock under StrictMode's mount/unmount/mount cycle.
    let cancelled = false;

    void (async () => {
      try {
        const factory = await stage.loadScene();
        if (cancelled) return;

        const stageSeed = deriveSeed(seed, stage.id);
        const context: StageContext = {
          stageId: stage.id,
          seed: stageSeed,
          rng: createRng(stageSeed),
          debug: GAME_CONFIG.debugOverlay,
          difficultyScale: GAME_CONFIG.difficultyScale,
          services: {
            playSe: (id, options) => audioService.playSe(id, options),
            playBgm: (id) => audioService.playBgm(id),
            stopBgm: (fadeMs) => audioService.stopBgm(fadeMs),
            vibrate: (pattern) => vibrate(pattern),
          },
          onComplete: ({ result, reason }) => {
            if (reason === 'abort') return;
            // Fired here rather than in the store because this is where the
            // reason is; threading it through `completeStage` would widen that
            // signature for analytics alone.
            trackEvent({ name: 'stage_finished', stage: result.stageId, outcome: reason });
            completeStage(result);
          },
          onDebugSnapshot: GAME_CONFIG.debugOverlay
            ? (snapshot: StageDebugSnapshot) => setDebugSnapshot(snapshot)
            : undefined,
        };

        host.startStage(factory, context);
      } catch (error) {
        console.error(`Failed to start stage "${stage.id}"`, error);
        fail('ステージの読み込みに失敗しました。通信環境を確認して再読み込みしてください。');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stage, seed, completeStage, fail, setDebugSnapshot]);

  return (
    <div
      ref={containerRef}
      className={`${styles.layer} ${visible ? styles.visible : styles.hidden}`}
      aria-hidden={!visible}
    />
  );
}
