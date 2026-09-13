/**
 * Pause overlay.
 *
 * Shown after the app returns from the background. Resuming is always an explicit
 * tap: dropping the player straight back into a running timer after they took a
 * phone call would be unfair, and the spec requires it.
 */
import { Button } from '@/components/ui/Button';
import styles from './Overlay.module.css';

export function PauseOverlay({ onResume, canResume }: { onResume(): void; canResume: boolean }) {
  return (
    <div className={styles.overlay} role="alertdialog" aria-label="一時停止">
      <div className={styles.icon} aria-hidden>
        ⏸
      </div>
      <h2 className={styles.title}>一時停止中</h2>
      <p className={styles.text}>
        {canResume ? 'タップすると続きから再開します。' : 'アプリに戻りました。'}
      </p>
      <Button large onClick={onResume}>
        {canResume ? '再開' : '続ける'}
      </Button>
    </div>
  );
}
