/**
 * Asset manifest integrity.
 *
 * This is the test that protects the project's headline requirement: artwork can be
 * swapped by editing one manifest entry, with no gameplay code changes. It checks
 * that every Asset ID resolves, that every file the manifest points at actually
 * exists, and that the declared sizes match the bytes on disk - so when the real
 * artwork arrives, a wrong frame count or a mis-sized sheet fails here rather than
 * silently rendering wrong in the game.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allAssets,
  findAsset,
  getAsset,
  assetStats,
  FALLBACK_ASSET_ID,
} from '@/assets/assetRegistry';
import { BREAD_ITEMS } from '@/config/stages/bread';
import { lateConfig } from '@/config/stages/late';
import { allStageModules } from '@/game/stages';
import type { AssetId } from '@/assets/assetRegistry';

const PUBLIC_DIR = join(process.cwd(), 'public');

function fileFor(src: string): string {
  return join(PUBLIC_DIR, src.replace(/^\//, ''));
}

/** Reads width/height straight out of a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } | null {
  const buffer = readFileSync(path);
  const isPng = buffer
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('asset manifest', () => {
  const assets = allAssets();

  it('is not empty and every id is unique', () => {
    expect(assets.length).toBeGreaterThan(0);
    expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);
  });

  it('points every entry at a file that exists', () => {
    const missing = assets
      .filter((asset) => !existsSync(fileFor(asset.definition.src)))
      .map((asset) => `${asset.id} -> ${asset.definition.src}`);

    expect(missing, 'run `npm run assets:placeholders` or fix the manifest src').toEqual([]);
  });

  it('never points two ids at the same file', () => {
    // A shared file is almost always a copy/paste slip, and it makes a swap ambiguous.
    const sources = assets.map((a) => a.definition.src);
    const duplicates = sources.filter((src, index) => sources.indexOf(src) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  it('serves everything from /assets/<bundle>/', () => {
    for (const asset of assets) {
      expect(asset.definition.src).toMatch(new RegExp(`^/assets/${asset.bundle}/`));
    }
  });

  it('gives every entry a usage note for whoever produces the real artwork', () => {
    for (const asset of assets) {
      expect(asset.definition.usage.length, asset.id).toBeGreaterThan(3);
    }
  });

  it('declares image sizes that match the real file', () => {
    const mismatches: string[] = [];

    for (const asset of assets) {
      const { definition } = asset;
      if (definition.kind !== 'image') continue;
      const size = pngSize(fileFor(definition.src));
      if (!size) continue; // a final asset may be WebP/AVIF; only PNGs are checked here
      if (
        size.width !== definition.recommendedSize.width ||
        size.height !== definition.recommendedSize.height
      ) {
        mismatches.push(
          `${asset.id}: file ${size.width}x${size.height}, manifest ` +
            `${definition.recommendedSize.width}x${definition.recommendedSize.height}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('declares spritesheet frames that match the real file', () => {
    const mismatches: string[] = [];

    for (const asset of assets) {
      const { definition } = asset;
      if (definition.kind !== 'spritesheet') continue;
      const size = pngSize(fileFor(definition.src));
      if (!size) continue;

      const expectedWidth = definition.frameSize.width * definition.frameCount;
      if (size.width !== expectedWidth || size.height !== definition.frameSize.height) {
        mismatches.push(
          `${asset.id}: file ${size.width}x${size.height}, manifest expects ` +
            `${expectedWidth}x${definition.frameSize.height} ` +
            `(${definition.frameCount} x ${definition.frameSize.width}px frames)`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('declares a sane frame count and rate for every animation', () => {
    for (const asset of assets) {
      if (asset.definition.kind !== 'spritesheet') continue;
      expect(asset.definition.frameCount, asset.id).toBeGreaterThan(0);
      expect(asset.definition.frameRate, asset.id).toBeGreaterThan(0);
    }
  });

  it('keeps the missing-asset fallback marked final so it is never "swapped in"', () => {
    expect(getAsset(FALLBACK_ASSET_ID).definition.status).toBe('final');
  });

  it('reports placeholder progress, which drives /dev/assets and docs/ASSETS.md', () => {
    const stats = assetStats();

    expect(stats.total).toBe(assets.length);
    expect(stats.placeholder + stats.final).toBe(stats.total);
    expect(Object.keys(stats.byBundle).sort()).toEqual(['bread', 'common', 'late', 'teacher']);
  });
});

describe('asset ids referenced from config', () => {
  it('resolves every bread product image', () => {
    for (const item of BREAD_ITEMS) {
      expect(findAsset(item.assetId), `${item.id} -> ${item.assetId}`).toBeDefined();
    }
  });

  it('resolves every obstacle, prop and gate image in stage 1', () => {
    for (const obstacle of lateConfig.obstacles) {
      const asset = findAsset(obstacle.assetId);
      expect(asset, obstacle.id).toBeDefined();
      // An animated obstacle must point at a spritesheet, not a still image.
      expect(asset?.definition.kind).toBe(obstacle.animated ? 'spritesheet' : 'image');
    }

    expect(findAsset(lateConfig.props.assetId)).toBeDefined();
    expect(findAsset(lateConfig.gate.assetId)).toBeDefined();
  });

  it('resolves the bundle of every registered stage', () => {
    const bundles = new Set(allAssets().map((asset) => asset.bundle));

    for (const stage of allStageModules()) {
      for (const bundle of stage.bundles) {
        expect(bundles.has(bundle), `${stage.id} -> ${bundle}`).toBe(true);
      }
      // Every stage needs the shared UI/particle/sound bundle.
      expect(stage.bundles).toContain('common');
    }
  });

  it('throws a helpful error for an unknown id instead of rendering nothing', () => {
    expect(() => getAsset('late.player.runn' as AssetId)).toThrow(/Unknown asset id/);
  });
});
