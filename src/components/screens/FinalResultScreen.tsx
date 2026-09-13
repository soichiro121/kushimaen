/**
 * Final result + score submission.
 *
 * The total shown while submitting is the client's own sum. Once the server answers,
 * its authoritative total replaces it - and if the two disagree the server's number
 * wins, visibly. Submission failure never blocks the player from continuing.
 */
import { useEffect } from 'react';
import { rankForStage, rankForTotal } from '@/config/rules';
import { audioService } from '@/services/audio/AudioService';
import { currentBackendMode } from '@/services/backendMode';
import { retrySubmission, useRunStore } from '@/stores/runStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getStageModule } from '@/game/stages';
import { useCountUp } from '@/utils/useCountUp';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { RankBadge } from '@/components/ui/RankBadge';
import { Screen, ScreenBody, ScreenFooter } from '@/components/ui/Screen';
import styles from './FinalResultScreen.module.css';

export function FinalResultScreen() {
  const results = useRunStore((state) => state.results);
  const clientTotal = useRunStore((state) => state.clientTotalScore());
  const status = useRunStore((state) => state.submissionStatus);
  const response = useRunStore((state) => state.submissionResponse);
  const error = useRunStore((state) => state.submissionError);
  const showLeaderboard = useRunStore((state) => state.showLeaderboard);
  const retry = useRunStore((state) => state.retry);
  const nickname = useSettingsStore((state) => state.nickname);

  const authoritativeTotal = response?.totalScore ?? clientTotal;
  const displayedTotal = useCountUp(authoritativeTotal, 1100, 420);

  useEffect(() => {
    audioService.playSe('common.se.result');
  }, []);

  return (
    <Screen>
      <ScreenBody scroll>
        <p className={styles.step}>FINAL RESULT</p>
        <h1 className={styles.player}>{nickname || 'ゲスト'}</h1>

        <ul className={styles.stageList}>
          {results.map((result) => {
            const stage = getStageModule(result.stageId);
            // Once the server has answered, show ITS number for each stage, not the
            // client's - the leaderboard is built from the server's values.
            const score = response?.stageScores?.[result.stageId] ?? result.score;
            return (
              <li key={result.stageId}>
                <RankBadge rank={rankForStage(result.stageId, score)} small />
                <span className={styles.stageName}>{stage.label}</span>
                <span className={styles.stageScore}>{score.toLocaleString('en-US')}</span>
              </li>
            );
          })}
        </ul>

        <div className={styles.totalBox}>
          <div>
            <p className={styles.totalLabel}>TOTAL</p>
            <p className={styles.total}>{displayedTotal.toLocaleString('en-US')}</p>
          </div>
          <RankBadge rank={rankForTotal(authoritativeTotal)} />
        </div>

        <Panel tight className={styles.status}>
          {status === 'pending' ? <p className={styles.statusText}>スコアを送信中…</p> : null}
          {status === 'done' ? (
            <p className={styles.statusOk}>
              スコアを登録しました
              {response?.rank ? `（歴代 ${response.rank} 位）` : ''}
              {currentBackendMode() === 'local' ? ' ・ LOCAL MODE' : ''}
            </p>
          ) : null}
          {status === 'failed' ? (
            <div>
              <p className={styles.statusBad}>{error ?? 'スコアを登録できませんでした'}</p>
              <Button variant="secondary" onClick={retrySubmission}>
                再送信する
              </Button>
            </div>
          ) : null}
          {response && !response.accepted && response.notice ? (
            <p className={styles.note}>{response.notice}</p>
          ) : null}
        </Panel>
      </ScreenBody>

      <ScreenFooter>
        <Button large block onClick={showLeaderboard}>
          ランキングを見る
        </Button>
        <Button variant="secondary" block onClick={retry}>
          もう一度あそぶ
        </Button>
      </ScreenFooter>
    </Screen>
  );
}
