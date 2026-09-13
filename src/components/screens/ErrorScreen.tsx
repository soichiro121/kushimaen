/**
 * Recoverable error screen.
 *
 * Reachable both from the flow machine (`fail()`) and from the React error boundary,
 * so an exception anywhere still leaves the player with a way forward instead of a
 * white page.
 */
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import styles from './ErrorScreen.module.css';

interface ErrorScreenProps {
  message: string;
  detail?: string | null;
  onRetry?(): void;
}

export function ErrorScreen({ message, detail, onRetry }: ErrorScreenProps) {
  return (
    <Screen centered>
      <div className={styles.wrap}>
        <div className={styles.icon} aria-hidden>
          ⚠️
        </div>
        <h1 className={styles.title}>問題が発生しました</h1>
        <p className={styles.message}>{message}</p>
        {detail ? <pre className={styles.detail}>{detail}</pre> : null}
        <div className={styles.actions}>
          {onRetry ? (
            <Button block onClick={onRetry}>
              タイトルに戻る
            </Button>
          ) : null}
          <Button variant="secondary" block onClick={() => window.location.reload()}>
            再読み込み
          </Button>
        </div>
      </div>
    </Screen>
  );
}
