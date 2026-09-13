/**
 * Per-stage result.
 *
 * Entirely generic: the metric rows come from the stage module's `formatMetrics`, so
 * this screen never needs to know which mini-game just finished.
 */
import { useEffect } from 'react';
import { rankForStage } from '@/config/rules';
import { audioService } from '@/services/audio/AudioService';
import { useRunStore } from '@/stores/runStore';
import { useCountUp } from '@/utils/useCountUp';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { RankBadge } from '@/components/ui/RankBadge';
import { Screen, ScreenBody, ScreenFooter } from '@/components/ui/Screen';
import styles from './StageResultScreen.module.css';

export function StageResultScreen() {
  const results = useRunStore((state) => state.results);
  const stage = useRunStore((state) => state.currentStage());
  const stageIndex = useRunStore((state) => state.stageIndex);
  const total = useRunStore((state) => state.stages().length);
  const advance = useRunStore((state) => state.advanceAfterStageResult);

  const result = results[results.length - 1];
  const displayedScore = useCountUp(result?.score ?? 0, 900, 180);

  useEffect(() => {
    audioService.playSe('common.se.result');
  }, []);

  if (!result || !stage) return null;

  const rank = rankForStage(result.stageId, result.score);
  const isLast = stageIndex + 1 >= total;

  return (
    <Screen>
      <ScreenBody scroll>
        <p className={styles.step}>
          STAGE {stageIndex + 1} / {total} 終了
        </p>
        <h1 className={styles.title}>{stage.label}</h1>

        <div className={styles.scoreRow}>
          <RankBadge rank={rank} />
          <div>
            <p className={styles.scoreLabel}>SCORE</p>
            <p className={styles.score}>{displayedScore.toLocaleString('en-US')}</p>
          </div>
        </div>

        <Panel heading="リザルト">
          <dl className={styles.metrics}>
            {stage.formatMetrics(result.metrics).map((row) => (
              <div key={row.label} className={styles.metricRow}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
            <div className={styles.metricRow}>
              <dt>プレイ時間</dt>
              <dd>{(result.durationMs / 1000).toFixed(1)} 秒</dd>
            </div>
          </dl>
        </Panel>
      </ScreenBody>

      <ScreenFooter>
        <Button large block onClick={advance}>
          {isLast ? '最終結果へ' : '次のステージへ'}
        </Button>
      </ScreenFooter>
    </Screen>
  );
}
