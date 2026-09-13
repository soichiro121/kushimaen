import type { Rank } from '@/config/rules';
import styles from './RankBadge.module.css';

export function RankBadge({ rank, small = false }: { rank: Rank; small?: boolean }) {
  return (
    <span
      className={[styles.badge, styles[rank], small ? styles.small : ''].filter(Boolean).join(' ')}
      aria-label={`ランク ${rank}`}
    >
      {rank}
    </span>
  );
}
