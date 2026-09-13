/**
 * Leaderboard: today / all-time, top 50, plus the player's own placement.
 *
 * A backend outage must not look like a broken game, so a failed fetch renders an
 * explanatory message and a retry button while the rest of the app keeps working.
 */
import { useCallback, useEffect, useState } from 'react';
import type { LeaderboardPeriod, LeaderboardResponse } from '@/services/api/types';
import {
  LEADERBOARD_PAGE_SIZE,
  leaderboardService,
} from '@/services/leaderboard/LeaderboardService';
import { useRunStore } from '@/stores/runStore';
import { Button } from '@/components/ui/Button';
import { Screen, ScreenBody, ScreenFooter, ScreenTitle } from '@/components/ui/Screen';
import styles from './LeaderboardScreen.module.css';

const PERIODS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'today', label: '今日' },
  { id: 'all', label: '歴代' },
];

export function LeaderboardScreen() {
  const session = useRunStore((state) => state.session);
  const retry = useRunStore((state) => state.retry);
  const hasPlayed = useRunStore((state) => state.results.length > 0);

  const [period, setPeriod] = useState<LeaderboardPeriod>('today');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [source, setSource] = useState<'remote' | 'local'>('local');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (target: LeaderboardPeriod) => {
      setLoading(true);
      setError(null);
      const result = await leaderboardService.fetch(target, {
        runId: session?.runId,
        limit: LEADERBOARD_PAGE_SIZE,
      });
      setData(result.data);
      setSource(result.source);
      setError(result.error);
      setLoading(false);
    },
    [session?.runId],
  );

  useEffect(() => {
    void load(period);
  }, [load, period]);

  return (
    <Screen>
      <ScreenTitle
        subtitle={source === 'local' ? 'LOCAL MODE（この端末のみの記録です）' : undefined}
      >
        ランキング
      </ScreenTitle>

      <div className={styles.tabs} role="tablist" aria-label="期間">
        {PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={period === item.id}
            className={`${styles.tab} ${period === item.id ? styles.tabActive : ''}`}
            onClick={() => setPeriod(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ScreenBody scroll>
        {loading ? <p className={styles.message}>読み込み中…</p> : null}

        {!loading && error ? (
          <div className={styles.errorBox}>
            <p className={styles.message}>ランキングを取得できませんでした</p>
            <p className={styles.detail}>{error}</p>
            <Button variant="secondary" onClick={() => void load(period)}>
              再試行
            </Button>
          </div>
        ) : null}

        {!loading && !error && data ? (
          data.entries.length === 0 ? (
            <p className={styles.message}>まだ記録がありません。最初の一人になりましょう。</p>
          ) : (
            <ol className={styles.list}>
              {data.entries.map((entry) => (
                <li
                  key={`${entry.rank}-${entry.nickname}-${entry.createdAt}`}
                  className={entry.isMe ? styles.rowMe : styles.row}
                >
                  <span className={styles.rank}>{entry.rank}</span>
                  <span className={styles.name}>{entry.nickname}</span>
                  <span className={styles.score}>{entry.totalScore.toLocaleString('en-US')}</span>
                </li>
              ))}
            </ol>
          )
        ) : null}

        {data?.me && !data.entries.some((entry) => entry.isMe) ? (
          <>
            <p className={styles.divider}>あなたの順位</p>
            <ol className={styles.list}>
              <li className={styles.rowMe}>
                <span className={styles.rank}>{data.me.rank}</span>
                <span className={styles.name}>{data.me.nickname}</span>
                <span className={styles.score}>{data.me.totalScore.toLocaleString('en-US')}</span>
              </li>
            </ol>
          </>
        ) : null}
      </ScreenBody>

      <ScreenFooter>
        <Button large block onClick={retry}>
          {hasPlayed ? 'もう一度あそぶ' : 'タイトルに戻る'}
        </Button>
      </ScreenFooter>
    </Screen>
  );
}
