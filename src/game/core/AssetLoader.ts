/**
 * Bridges the asset registry to Phaser's loader.
 *
 * Game code never calls `this.load.image('/assets/...')`. It asks for an Asset ID and
 * this module decides how to load it, what the texture key is, and what happens when
 * the file is missing.
 *
 * Missing-asset policy (spec requirement): a failed load must never crash the game.
 * The key is bound to a visible fallback texture and a clear message is logged:
 *
 *     Missing asset: late.student.normal01 (/assets/late/student-normal01.png)
 */
import Phaser from 'phaser';
import type { AssetBundleId } from '@/assets/assetTypes';
import {
  allAssets,
  assetUrl,
  assetsInBundle,
  getAsset,
  FALLBACK_ASSET_ID,
  type AssetId,
} from '@/assets/assetRegistry';

/** Texture keys are the Asset IDs themselves - one vocabulary everywhere. */
export function textureKey(id: AssetId): string {
  return id;
}

export function animationKey(id: AssetId): string {
  return `anim:${id}`;
}

const failedAssets = new Set<string>();

/** IDs that failed to load in this session (surfaced by the debug overlay). */
export function missingAssetIds(): readonly string[] {
  return [...failedAssets];
}

/**
 * Queues every image/spritesheet of a bundle onto a scene's loader.
 * Audio is handled separately by `AudioService` (WebAudio, shared with the React UI).
 */
export function queueBundle(loader: Phaser.Loader.LoaderPlugin, bundle: AssetBundleId): void {
  for (const asset of assetsInBundle(bundle)) {
    queueAsset(loader, asset.id as AssetId);
  }
}

export function queueAsset(loader: Phaser.Loader.LoaderPlugin, id: AssetId): void {
  const { definition } = getAsset(id);
  const key = textureKey(id);
  if (loader.textureManager.exists(key)) return;

  switch (definition.kind) {
    case 'image':
      loader.image(key, assetUrl(id));
      break;
    case 'spritesheet':
      loader.spritesheet(key, assetUrl(id), {
        frameWidth: definition.frameSize.width,
        frameHeight: definition.frameSize.height,
      });
      break;
    case 'audio':
      // Intentionally skipped: see AudioService.
      break;
  }
}

/**
 * Installs the missing-asset safety net on a loader. Call once per scene, in
 * `preload()`, before queueing anything.
 */
export function installFallbackHandling(scene: Phaser.Scene): void {
  ensureFallbackTexture(scene);

  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
    const id = file.key;
    if (failedAssets.has(id)) return;
    failedAssets.add(id);
    console.error(`Missing asset: ${id} (${file.url})`);
    bindFallbackTexture(scene, id);
  });
}

/** The fallback texture is generated in code so it can never itself be missing. */
export function ensureFallbackTexture(scene: Phaser.Scene): void {
  const key = textureKey(FALLBACK_ASSET_ID);
  if (scene.textures.exists(key)) return;

  const size = 64;
  const cell = 16;
  const canvasTexture = scene.textures.createCanvas(key, size, size);
  const ctx = canvasTexture?.getContext();
  if (!ctx || !canvasTexture) return;

  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#c0397f';
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      if ((x / cell + y / cell) % 2 === 0) ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', size / 2, size / 2);
  canvasTexture.refresh();
}

/**
 * Binds a failed key to the fallback image, registered as a single-frame sprite sheet
 * so that both `add.image(key)` and `add.sprite(key, 0)` keep working.
 */
function bindFallbackTexture(scene: Phaser.Scene, key: string): void {
  ensureFallbackTexture(scene);
  if (scene.textures.exists(key)) return;
  const source = scene.textures.get(textureKey(FALLBACK_ASSET_ID)).getSourceImage();
  scene.textures.addSpriteSheet(key, source as HTMLImageElement, {
    frameWidth: 64,
    frameHeight: 64,
  });
}

/**
 * Creates (once) the Phaser animation described by a spritesheet asset and returns
 * its key. Frame count is clamped to what the texture actually contains, so an
 * artwork swap with a different frame count degrades gracefully instead of throwing.
 */
export function ensureAnimation(scene: Phaser.Scene, id: AssetId): string {
  const key = animationKey(id);
  if (scene.anims.exists(key)) return key;

  const { definition } = getAsset(id);
  if (definition.kind !== 'spritesheet') {
    throw new Error(`ensureAnimation("${id}") requires a spritesheet asset.`);
  }

  const texture = scene.textures.get(textureKey(id));
  // `__BASE` is Phaser's implicit whole-image frame and is not a real animation frame.
  const availableFrames = Math.max(1, texture.getFrameNames().length);
  const frameCount = Math.min(definition.frameCount, availableFrames);

  if (frameCount !== definition.frameCount) {
    console.warn(
      `Asset "${id}" declares ${definition.frameCount} frames but the texture has ` +
        `${availableFrames}. Using ${frameCount}. Update frameCount in assetManifest.ts.`,
    );
  }

  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNumbers(textureKey(id), { start: 0, end: frameCount - 1 }),
    frameRate: definition.frameRate,
    repeat: definition.loop ? -1 : 0,
  });
  return key;
}

/**
 * Plays the animation for a spritesheet asset on a sprite, creating it on demand.
 * This is the only call sites should need - they never touch frame numbers.
 */
export function playAsset(sprite: Phaser.GameObjects.Sprite, id: AssetId): void {
  const key = ensureAnimation(sprite.scene, id);
  if (sprite.anims.currentAnim?.key !== key) sprite.anims.play(key, true);
}

/** True once every image/spritesheet of a bundle is present in the texture manager. */
export function isBundleLoaded(scene: Phaser.Scene, bundle: AssetBundleId): boolean {
  return assetsInBundle(bundle)
    .filter((asset) => asset.definition.kind !== 'audio')
    .every((asset) => scene.textures.exists(textureKey(asset.id as AssetId)));
}

/**
 * Preloads bundles outside of a scene's own preload phase (used to warm stage 2/3
 * while the player is on the title screen or in stage 1). Resolves even on failure -
 * the fallback path covers it.
 */
export function preloadBundlesInBackground(
  scene: Phaser.Scene,
  bundles: readonly AssetBundleId[],
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const pending = bundles.filter((bundle) => !isBundleLoaded(scene, bundle));
  if (pending.length === 0) {
    onProgress?.(1);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    for (const bundle of pending) queueBundle(scene.load, bundle);

    const handleProgress = (ratio: number): void => onProgress?.(ratio);
    if (onProgress) scene.load.on(Phaser.Loader.Events.PROGRESS, handleProgress);

    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (onProgress) {
        scene.load.off(Phaser.Loader.Events.PROGRESS, handleProgress);
        onProgress(1);
      }
      resolve();
    });
    scene.load.start();
  });
}

/** Image/spritesheet count, used by the loading screen for a real progress bar. */
export function imageAssetCount(bundles: readonly AssetBundleId[]): number {
  return allAssets().filter(
    (asset) => bundles.includes(asset.bundle) && asset.definition.kind !== 'audio',
  ).length;
}
