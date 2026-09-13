/**
 * Maintenance mode (`VITE_MAINTENANCE=1`).
 *
 * An ops lever: the frontend can be taken offline without touching the server or the
 * database, which matters when the game is handed out by QR code to a whole school.
 */
import { GAME_CONFIG } from '@/config/game';
import { Screen } from '@/components/ui/Screen';
import styles from './ErrorScreen.module.css';

export function MaintenanceScreen() {
  return (
    <Screen centered>
      <div className={styles.wrap}>
        <div className={styles.icon} aria-hidden>
          🛠
        </div>
        <h1 className={styles.title}>メンテナンス中</h1>
        <p className={styles.message}>
          {GAME_CONFIG.title} は現在メンテナンス中です。
          <br />
          しばらくしてからもう一度お試しください。
        </p>
      </div>
    </Screen>
  );
}
