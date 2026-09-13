/**
 * Vibration.
 *
 * Strictly an enhancement: iOS Safari has no Vibration API at all, so nothing in the
 * game may depend on it. Every call is a no-op when unsupported or switched off.
 */

let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Patterns are kept short: long buzzes feel broken on a phone in a pocket. */
export const HAPTIC_PATTERNS = {
  tap: 8,
  nearMiss: 12,
  collision: [0, 40, 30, 60] as number[],
  mistake: 35,
  caught: [0, 60, 40, 90] as number[],
  success: 18,
} as const;

export function vibrate(pattern: number | number[]): void {
  if (!enabled || !hapticsSupported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when the page is not visible */
  }
}
