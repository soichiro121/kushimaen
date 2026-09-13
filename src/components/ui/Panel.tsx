import type { ReactNode } from 'react';
import styles from './Panel.module.css';

export function Panel({
  children,
  heading,
  tight = false,
  className,
}: {
  children: ReactNode;
  heading?: string;
  tight?: boolean;
  className?: string;
}) {
  return (
    <section
      className={[styles.panel, tight ? styles.tight : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {heading ? <h2 className={styles.heading}>{heading}</h2> : null}
      {children}
    </section>
  );
}
