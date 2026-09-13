/**
 * Development-only routes.
 *
 *   /dev         - launch any stage directly
 *   /dev/assets  - browse every Asset ID with its current file
 *
 * This module is lazily imported and is only reachable when
 * `GAME_CONFIG.devToolsAvailable` is true (a dev build, or a build made with
 * `VITE_ENABLE_DEV_TOOLS=1`). Ordinary players on production can never open it.
 */
import { useState } from 'react';
import { App } from '@/app/App';
import { AssetBrowser } from './AssetBrowser';
import { StageSelect } from './StageSelect';

export function DevRoutes({ path }: { path: string }) {
  const [launched, setLaunched] = useState(false);

  if (path.includes('/dev/assets')) return <AssetBrowser />;
  if (launched) return <App />;
  return <StageSelect onLaunch={() => setLaunched(true)} />;
}
