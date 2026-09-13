/**
 * Stage intro.
 *
 * Rendered generically from the stage module's own metadata, so a new mini-game gets
 * a correct intro screen for free.
 */
import { useRunStore } from '@/stores/runStore';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Screen, ScreenBody, ScreenFooter } from '@/components/ui/Screen';
import styles from './StageIntroScreen.module.css';

export function StageIntroScreen() {
  const stage = useRunStore((state) => state.currentStage());
  const stageIndex = useRunStore((state) => state.stageIndex);
  const total = useRunStore((state) => state.stages().length);
  const beginStage = useRunStore((state) => state.beginStage);

  if (!stage) return null;

  return (
    <Screen>
      <ScreenBody scroll>
        <p className={styles.step}>
          STAGE {stageIndex + 1} / {total}
        </p>
        <h1 className={styles.title}>{stage.label}</h1>
        <p className={styles.tagline}>{stage.tagline}</p>

        <Panel heading="ルール" className={styles.panel}>
          <ul className={styles.rules}>
            {stage.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </Panel>

        <Panel heading="そうさ" className={styles.panel} tight>
          <p className={styles.control}>{stage.controlHint}</p>
        </Panel>

        <p className={styles.duration}>目安プレイ時間: 約 {stage.approxDurationSec} 秒</p>
      </ScreenBody>

      <ScreenFooter>
        <Button large block onClick={beginStage}>
          はじめる
        </Button>
      </ScreenFooter>
    </Screen>
  );
}
