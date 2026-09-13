/**
 * Full-screen layout primitive.
 *
 * Every route uses it so safe-area padding, the enter animation and the
 * header/body/footer rhythm are identical across the app.
 */
import type { ReactNode } from 'react';
import styles from './Screen.module.css';

interface ScreenProps {
  children: ReactNode;
  /** Centres the content - used by the title, loading and error screens. */
  centered?: boolean;
  className?: string;
}

export function Screen({ children, centered = false, className }: ScreenProps) {
  const classes = [styles.screen, centered ? styles.centered : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <div className={classes}>{children}</div>;
}

export function ScreenBody({
  children,
  scroll = false,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  return <div className={`${styles.body} ${scroll ? 'scroll-area' : ''}`}>{children}</div>;
}

export function ScreenFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

export function ScreenTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <header>
      <h1 className={styles.title}>{children}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </header>
  );
}
