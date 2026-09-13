/**
 * Portrait-only detection.
 *
 * Every stage is laid out for a tall viewport, so landscape play is blocked rather
 * than letting the HUD collide with the playfield. The check is deliberately narrow:
 * it only fires on a touch device that is actually short in landscape, so a desktop
 * browser or a large tablet is never blocked.
 */
import { useEffect, useState } from 'react';

const MAX_LANDSCAPE_HEIGHT = 560;

function isBlockedOrientation(): boolean {
  if (typeof window === 'undefined') return false;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const landscape = window.innerWidth > window.innerHeight;
  return coarsePointer && landscape && window.innerHeight < MAX_LANDSCAPE_HEIGHT;
}

export function useOrientationBlocked(): boolean {
  const [blocked, setBlocked] = useState(isBlockedOrientation);

  useEffect(() => {
    const update = (): void => setBlocked(isBlockedOrientation());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return blocked;
}
