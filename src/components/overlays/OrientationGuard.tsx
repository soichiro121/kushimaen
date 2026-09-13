/** Overlay shown while the device is held in landscape. */
import styles from './Overlay.module.css';

export function OrientationGuard() {
  return (
    <div className={styles.overlay} role="alertdialog" aria-label="画面の向き">
      <div className={styles.rotateHint} aria-hidden />
      <h2 className={styles.title}>縦向きでプレイしてください</h2>
      <p className={styles.text}>端末を縦向きに戻すと、そのまま続きから再開できます。</p>
    </div>
  );
}
