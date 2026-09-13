/**
 * Safe-area inset measurement.
 *
 * The game canvas covers the whole screen so artwork reaches the edges, which means
 * Phaser - not CSS - has to keep the HUD clear of the Dynamic Island, the notch and
 * the home indicator. `env(safe-area-inset-*)` is not readable from JS directly, so
 * we measure it through a probe element whose padding is set from those variables.
 */

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

let probe: HTMLElement | null = null;

function getProbe(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (probe?.isConnected) return probe;

  probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top, 0px)',
    'padding-right:env(safe-area-inset-right, 0px)',
    'padding-bottom:env(safe-area-inset-bottom, 0px)',
    'padding-left:env(safe-area-inset-left, 0px)',
  ].join(';');
  document.body.appendChild(probe);
  return probe;
}

export function readSafeAreaInsets(): SafeAreaInsets {
  const element = getProbe();
  if (!element) return { ...ZERO_INSETS };
  const style = getComputedStyle(element);
  const toPx = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    top: toPx(style.paddingTop),
    right: toPx(style.paddingRight),
    bottom: toPx(style.paddingBottom),
    left: toPx(style.paddingLeft),
  };
}

/**
 * A small extra margin on top of the OS inset. Even on a device with no notch the
 * HUD should not sit flush against the edge, and the browser chrome on Android can
 * overlap the last few pixels during scroll-collapse.
 */
export const HUD_EDGE_PADDING = 12;

export function hudInsets(): SafeAreaInsets {
  const insets = readSafeAreaInsets();
  return {
    top: insets.top + HUD_EDGE_PADDING,
    right: insets.right + HUD_EDGE_PADDING,
    bottom: insets.bottom + HUD_EDGE_PADDING,
    left: insets.left + HUD_EDGE_PADDING,
  };
}
