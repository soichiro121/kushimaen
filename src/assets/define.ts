/**
 * Small constructors used by `assetManifest.ts`.
 *
 * They exist so the manifest reads as a flat, reviewable table: whoever swaps in the
 * real artwork only has to understand `src`, `status` and the size fields.
 */
import type { AudioAsset, ImageAsset, SpritesheetAsset } from './assetTypes';

export function img(definition: Omit<ImageAsset, 'kind'>): ImageAsset {
  return { kind: 'image', ...definition };
}

export function sheet(definition: Omit<SpritesheetAsset, 'kind'>): SpritesheetAsset {
  return { kind: 'spritesheet', ...definition };
}

export function sfx(definition: Omit<AudioAsset, 'kind' | 'channel'>): AudioAsset {
  return { kind: 'audio', channel: 'se', ...definition };
}

export function bgm(definition: Omit<AudioAsset, 'kind' | 'channel'>): AudioAsset {
  return { kind: 'audio', channel: 'bgm', loop: true, ...definition };
}
