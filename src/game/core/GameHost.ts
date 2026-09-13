/**
 * Owns the single Phaser.Game instance and its lifecycle.
 *
 * React mounts a host once and asks it to run stages; it never constructs Phaser
 * itself. Keeping this in one place is what makes pause/resume, orientation locking,
 * background preloading and clean teardown reliable.
 *
 * Textures live on the Game, not on a Scene, so a bundle preloaded by the warm-up
 * scene is immediately available to every stage.
 */
import Phaser from 'phaser';
import type { AssetBundleId } from '@/assets/assetTypes';
import { GAME_CONFIG } from '@/config/game';
import { ensureFallbackTexture, preloadBundlesInBackground } from './AssetLoader';
import type { BaseStageScene } from './BaseStageScene';
import type { StageContext, StageSceneFactory } from './stageTypes';

const WARMUP_SCENE_KEY = 'warmup';

/** An always-present, invisible scene used for background asset preloading. */
class WarmupScene extends Phaser.Scene {
  constructor() {
    super({ key: WARMUP_SCENE_KEY, active: true });
  }

  create(): void {
    ensureFallbackTexture(this);
  }
}

export class GameHost {
  private readonly game: Phaser.Game;
  private currentSceneKey: string | null = null;
  private destroyed = false;

  private constructor(game: Phaser.Game) {
    this.game = game;
  }

  static create(parent: HTMLElement): GameHost {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#10141c',
      scale: {
        // RESIZE keeps game units equal to CSS pixels, so layout code can reason in
        // the same units as the React shell and adapts to any aspect ratio.
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
        autoRound: true,
      },
      render: {
        antialias: true,
        roundPixels: true,
        powerPreference: 'high-performance',
        // Transparent canvas would force the compositor to blend every frame.
        transparent: false,
      },
      fps: { target: 60, min: 30 },
      // React owns pausing; Phaser's own blur handling would fight our overlay.
      autoFocus: false,
      disableContextMenu: true,
      audio: { noAudio: true }, // audio goes through AudioService (shared with React)
      scene: [WarmupScene],
    });
    // Dev affordance: lets the debug console reach the running game
    // (`window.__KOMATO_GAME__.scene.scenes`). Never attached in production.
    if (GAME_CONFIG.debugOverlay) {
      (window as unknown as { __KOMATO_GAME__?: Phaser.Game }).__KOMATO_GAME__ = game;
    }
    return new GameHost(game);
  }

  get phaserGame(): Phaser.Game {
    return this.game;
  }

  /** Adds and starts a stage scene, replacing any scene already running. */
  startStage(factory: StageSceneFactory, context: StageContext): BaseStageScene {
    this.stopCurrentStage();
    const scene = factory(context) as BaseStageScene;
    const key = `stage:${context.stageId}`;
    this.game.scene.add(key, scene, true);
    this.currentSceneKey = key;
    return scene;
  }

  stopCurrentStage(): void {
    if (!this.currentSceneKey) return;
    const existing = this.game.scene.getScene(this.currentSceneKey);
    if (existing) {
      this.game.scene.stop(this.currentSceneKey);
      this.game.scene.remove(this.currentSceneKey);
    }
    this.currentSceneKey = null;
  }

  private get activeStage(): BaseStageScene | null {
    if (!this.currentSceneKey) return null;
    return (this.game.scene.getScene(this.currentSceneKey) as BaseStageScene | null) ?? null;
  }

  pause(): void {
    this.activeStage?.pauseStage();
    this.game.loop.sleep();
  }

  resume(): void {
    this.game.loop.wake();
    this.activeStage?.resumeStage();
  }

  /**
   * Warms bundles that a later stage will need, without blocking the current one.
   * Runs on the dedicated warm-up scene so it cannot interfere with a stage loader.
   */
  async preload(
    bundles: readonly AssetBundleId[],
    onProgress?: (ratio: number) => void,
  ): Promise<void> {
    if (this.destroyed) return;
    const scene = this.game.scene.getScene(WARMUP_SCENE_KEY);
    if (!scene) {
      onProgress?.(1);
      return;
    }
    await preloadBundlesInBackground(scene, bundles, onProgress);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopCurrentStage();
    this.game.destroy(true, false);
  }
}
