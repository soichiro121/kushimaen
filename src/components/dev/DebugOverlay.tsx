/**
 * Development overlay, enabled with `?debug=1`.
 *
 * Never reachable in a normal production build: `GAME_CONFIG.debugOverlay` is false
 * unless the bundle is a dev build or was explicitly built with
 * `VITE_ENABLE_DEV_TOOLS=1` (e.g. a staging URL).
 */
import { useEffect, useState } from 'react';
import { GAME_CONFIG } from '@/config/game';
import { missingAssetIds } from '@/game/core/AssetLoader';
import { currentBackendMode } from '@/services/backendMode';
import { useDebugStore } from '@/stores/debugStore';
import { useRunStore } from '@/stores/runStore';
import styles from './DebugOverlay.module.css';

export function DebugOverlay() {
  const snapshot = useDebugStore((state) => state.snapshot);
  const session = useRunStore((state) => state.session);
  const screen = useRunStore((state) => state.screen);
  const stage = useRunStore((state) => state.currentStage());
  const completeStage = useRunStore((state) => state.completeStage);
  const [fps, setFps] = useState(0);

  // Sampled from rAF rather than Phaser so it also reports React-side stalls.
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      frames += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!GAME_CONFIG.debugOverlay) return null;

  const missing = missingAssetIds();

  const lines = [
    `fps      ${fps}`,
    `screen   ${screen}`,
    `backend  ${currentBackendMode()}`,
    `run      ${session?.runId ?? '-'}`,
    `seed     ${session?.seed ?? '-'}`,
    `cfgVer   ${GAME_CONFIG.configVersion}`,
    `stage    ${stage?.id ?? '-'}`,
    snapshot ? `score    ${snapshot.score}` : null,
    snapshot ? `timeLeft ${Math.round(snapshot.timeLeftMs)}` : null,
    snapshot ? `combo    ${snapshot.combo}` : null,
    snapshot?.state ? `state    ${snapshot.state}` : null,
    ...Object.entries(snapshot?.extra ?? {}).map(([key, value]) => `${key.padEnd(8)} ${value}`),
  ].filter(Boolean);

  return (
    <>
      <div className={styles.panel}>
        {lines.join('\n')}
        {missing.length > 0 ? (
          <span
            className={styles.warn}
          >{`\nmissing  ${missing.length} asset(s)\n${missing.join('\n')}`}</span>
        ) : null}
      </div>

      {screen === 'stage' && stage ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={() =>
              completeStage(
                stage.debugSampleResult?.() ?? {
                  stageId: stage.id,
                  score: 0,
                  durationMs: 0,
                  metrics: {},
                },
              )
            }
          >
            skip stage
          </button>
        </div>
      ) : null}
    </>
  );
}
