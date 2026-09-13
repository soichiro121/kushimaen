/**
 * Animated number, used by the result screens.
 *
 * Driven by requestAnimationFrame rather than an interval so it stays smooth and
 * stops cleanly when the component unmounts or the tab is backgrounded. It also
 * honours `prefers-reduced-motion` by jumping straight to the final value.
 */
import { useEffect, useState } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(target: number, durationMs = 900, delayMs = 0): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion() || durationMs <= 0) {
      setValue(target);
      return;
    }

    let frame = 0;
    let startedAt = 0;
    let cancelled = false;

    const step = (now: number): void => {
      if (cancelled) return;
      if (startedAt === 0) startedAt = now;
      const elapsed = now - startedAt - delayMs;
      if (elapsed < 0) {
        frame = requestAnimationFrame(step);
        return;
      }
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [target, durationMs, delayMs]);

  return value;
}
