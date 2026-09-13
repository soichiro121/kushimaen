/**
 * Loading screen.
 *
 * Loads ONLY what is needed to reach the title and play stage 1. Stages 2 and 3 are
 * warmed in the background later (see `App.tsx`), so the first screen appears fast
 * on a phone connection.
 */
import { useEffect, useState } from 'react';
import { GAME_CONFIG } from '@/config/game';
import { preloadBundles } from '@/game/core/hostAccess';
import { detectBackendMode } from '@/services/backendMode';
import { useRunStore } from '@/stores/runStore';
import { Screen } from '@/components/ui/Screen';
import styles from './LoadingScreen.module.css';

const INITIAL_BUNDLES = ['common', 'late'] as const;

export function LoadingScreen() {
  const goToTitle = useRunStore((state) => state.goToTitle);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Both steps are idempotent (assets are cached, the backend probe is memoised),
    // so this effect is safe to run more than once - which React StrictMode does in
    // development. Only the progress updates are cancelled on unmount; the screen
    // transition itself must still happen, or the app would hang on the loader.
    let cancelled = false;
    void (async () => {
      // The backend probe runs alongside asset loading: a slow or missing API must
      // never hold up the title screen.
      await Promise.all([
        preloadBundles(INITIAL_BUNDLES, (ratio) => {
          if (!cancelled) setProgress(ratio);
        }),
        detectBackendMode(),
      ]);
      if (!cancelled) setProgress(1);
      goToTitle();
    })();

    return () => {
      cancelled = true;
    };
  }, [goToTitle]);

  return (
    <Screen centered>
      <div className={styles.wrap}>
        <p className={styles.brand}>{GAME_CONFIG.title}</p>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="読み込み中"
        >
          <div className={styles.bar} style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className={styles.caption}>読み込み中… {Math.round(progress * 100)}%</p>
      </div>
    </Screen>
  );
}
