/**
 * Top-level route switch.
 *
 * The app is a flow machine rather than a routed site, so there is no router: the
 * only real routes are the development tools, which are code-split and unreachable
 * unless `GAME_CONFIG.devToolsAvailable` is true (a dev build, or a build made with
 * `VITE_ENABLE_DEV_TOOLS=1`).
 */
import { Suspense, lazy } from 'react';
import { App } from './App';
import { GAME_CONFIG } from '@/config/game';

const DevRoutes = lazy(async () => {
  const module = await import('@/dev/DevRoutes');
  return { default: module.DevRoutes };
});

export function Root() {
  const path = window.location.pathname.replace(/\/+$/, '');
  const isDevRoute = path.endsWith('/dev') || path.includes('/dev/');

  if (isDevRoute && GAME_CONFIG.devToolsAvailable) {
    return (
      <Suspense fallback={null}>
        <DevRoutes path={path} />
      </Suspense>
    );
  }
  return <App />;
}
