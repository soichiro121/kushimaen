/**
 * Analytics, behind one door.
 *
 * Nothing in the app imports the vendor directly - it calls `trackEvent` with a
 * value from the `AnalyticsEvent` union. That keeps the whole surface swappable,
 * keeps it testable, and means the list of what is collected lives in one file
 * (`events.ts`) rather than being scattered across the components that fire it.
 *
 * WHAT IS ACTUALLY COLLECTED WHERE
 *   Page views work on every Vercel plan. CUSTOM EVENTS ARE A PRO FEATURE: on Hobby
 *   they are simply not collected, so the calls below are inert until the project is
 *   on Pro. They are here anyway because they cost nothing to leave in and start
 *   working the moment the plan changes - see docs/DEPLOYMENT.md.
 *
 * OPTING OUT
 *   Do Not Track and Global Privacy Control are honoured. Vercel Web Analytics is
 *   cookieless and collects no personal data, but a player who has asked not to be
 *   measured has asked, and the request costs us nothing to respect.
 */
import { track } from '@vercel/analytics';
import { toPayload, type AnalyticsEvent } from './events';

export type { AnalyticsEvent } from './events';

/**
 * Whether the browser has asked not to be tracked.
 *
 * Read once: these do not change mid-session, and this is called on a hot path.
 */
function optedOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const nav = navigator as Navigator & {
    doNotTrack?: string;
    globalPrivacyControl?: boolean;
  };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

let enabled: boolean | null = null;

/**
 * Production builds only.
 *
 * Not just to keep the numbers clean: the vendor's `track` logs to the console
 * outside production, which would bury real output in `npm run dev` and in the
 * test suite. The Vercel component is separately inert in development.
 */
function isEnabled(): boolean {
  return (enabled ??= import.meta.env.PROD && typeof window !== 'undefined' && !optedOut());
}

/**
 * Sends one event. Never throws.
 *
 * A failure here must not be visible: analytics is the least important thing on the
 * page, and the one most likely to be blocked by an extension or a school network.
 */
export function trackEvent(event: AnalyticsEvent): void {
  if (!isEnabled()) return;
  try {
    const { name, properties } = toPayload(event);
    track(name, properties);
  } catch {
    // Deliberately silent. See above.
  }
}

/** Test seam: forces the enabled/disabled decision. */
export function resetAnalytics(state: boolean | null = null): void {
  enabled = state;
}
