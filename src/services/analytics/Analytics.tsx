/**
 * Mounts Vercel Web Analytics.
 *
 * Page views only come from this component; custom events go through
 * `trackEvent` in `analytics.ts`. Both are no-ops in development.
 */
import { Analytics as VercelAnalytics } from '@vercel/analytics/react';

/**
 * Strips the query string before anything is reported.
 *
 * The game puts debug switches there (`?debug=1`, the dev stage overrides), and a
 * query string is the classic place for something personal to end up in an
 * analytics URL. Nothing here needs it, so it never leaves.
 */
function beforeSend<T extends { url: string }>(event: T): T {
  const [path] = event.url.split('?');
  return { ...event, url: path ?? event.url };
}

export function Analytics() {
  return <VercelAnalytics beforeSend={beforeSend} />;
}
