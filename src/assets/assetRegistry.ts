/**
 * Asset registry - the only API game code may use to reach an asset.
 *
 * It flattens `assetManifest.ts` into a lookup table keyed by dotted Asset ID
 * (`late.player.run`, `bread.item.curry`, ...) and hands out URLs and metadata.
 *
 * Deliberately framework-agnostic: no Phaser import, so it is unit-testable and
 * reusable by the React UI and the dev asset browser. Phaser wiring lives in
 * `src/game/core/AssetLoader.ts`.
 */
import { assetManifest, type AssetManifest } from './assetManifest';
import {
  isAssetDefinition,
  type AssetBundleId,
  type AssetDefinition,
  type AssetGroup,
  type AssetPaths,
  type AudioAsset,
  type ImageAsset,
  type ResolvedAsset,
  type SpritesheetAsset,
} from './assetTypes';

/** Compile-time-checked union of every Asset ID in the manifest. */
export type AssetId = AssetPaths<AssetManifest>;

/** The asset shown when anything fails to load. */
export const FALLBACK_ASSET_ID = 'common.ui.fallback' satisfies AssetId;

function flatten(): ReadonlyMap<string, ResolvedAsset> {
  const table = new Map<string, ResolvedAsset>();

  const walk = (node: AssetGroup, path: string[], bundle: AssetBundleId): void => {
    for (const [key, child] of Object.entries(node)) {
      const nextPath = [...path, key];
      if (isAssetDefinition(child as AssetDefinition | AssetGroup)) {
        const id = nextPath.join('.');
        table.set(id, { id, bundle, definition: child as AssetDefinition });
      } else {
        walk(child as AssetGroup, nextPath, bundle);
      }
    }
  };

  for (const [bundle, group] of Object.entries(assetManifest)) {
    walk(group as unknown as AssetGroup, [bundle], bundle as AssetBundleId);
  }
  return table;
}

const TABLE = flatten();

/** Every Asset ID in the manifest, in declaration order. */
export function allAssetIds(): AssetId[] {
  return [...TABLE.keys()] as AssetId[];
}

export function allAssets(): ResolvedAsset[] {
  return [...TABLE.values()];
}

export function assetsInBundle(bundle: AssetBundleId): ResolvedAsset[] {
  return allAssets().filter((asset) => asset.bundle === bundle);
}

export function hasAsset(id: string): boolean {
  return TABLE.has(id);
}

/**
 * Look up an asset. Throws for an unknown ID: that is always a programming error
 * (the ID union makes it impossible from typed code) and failing loudly during
 * development is better than a silently invisible sprite.
 */
export function getAsset(id: AssetId): ResolvedAsset {
  const asset = TABLE.get(id);
  if (!asset) {
    throw new Error(
      `Unknown asset id "${id}". Add it to src/assets/assetManifest.ts or fix the reference.`,
    );
  }
  return asset;
}

/** Non-throwing variant for dynamic IDs coming from config/data files. */
export function findAsset(id: string): ResolvedAsset | undefined {
  return TABLE.get(id);
}

export function getImageAsset(id: AssetId): ImageAsset {
  const { definition } = getAsset(id);
  if (definition.kind !== 'image') {
    throw new Error(`Asset "${id}" is a ${definition.kind}, expected an image.`);
  }
  return definition;
}

export function getSpritesheetAsset(id: AssetId): SpritesheetAsset {
  const { definition } = getAsset(id);
  if (definition.kind !== 'spritesheet') {
    throw new Error(`Asset "${id}" is a ${definition.kind}, expected a spritesheet.`);
  }
  return definition;
}

export function getAudioAsset(id: AssetId): AudioAsset {
  const { definition } = getAsset(id);
  if (definition.kind !== 'audio') {
    throw new Error(`Asset "${id}" is a ${definition.kind}, expected audio.`);
  }
  return definition;
}

/**
 * Resolves a manifest `src` against the deployment base path, so the same build
 * works at `https://example.com/` and at `https://example.com/komato/`.
 */
export function assetUrl(id: AssetId): string {
  return resolveSrc(getAsset(id).definition.src);
}

export function resolveSrc(src: string): string {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/+$/, '');
  return src.startsWith('/') ? `${base}${src}` : `${base}/${src}`;
}

/** Intrinsic pixel size of an asset, used for layout maths and the dev browser. */
export function assetSize(id: AssetId): { width: number; height: number } | null {
  const { definition } = getAsset(id);
  if (definition.kind === 'image') return definition.recommendedSize;
  if (definition.kind === 'spritesheet') return definition.frameSize;
  return null;
}

export interface AssetStats {
  total: number;
  placeholder: number;
  final: number;
  byBundle: Record<AssetBundleId, { total: number; placeholder: number }>;
}

/** Powers the "remaining work" summary in `/dev/assets`. */
export function assetStats(): AssetStats {
  const byBundle = {} as AssetStats['byBundle'];
  let placeholder = 0;
  for (const asset of allAssets()) {
    const bucket = (byBundle[asset.bundle] ??= { total: 0, placeholder: 0 });
    bucket.total += 1;
    if (asset.definition.status === 'placeholder') {
      bucket.placeholder += 1;
      placeholder += 1;
    }
  }
  const total = TABLE.size;
  return { total, placeholder, final: total - placeholder, byBundle };
}
