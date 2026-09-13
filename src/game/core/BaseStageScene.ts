/**
 * Base class for every mini-game scene.
 *
 * It owns the parts that must behave identically across stages - asset loading with
 * fallbacks, the pause-safe clock, the score manager, the HUD, the ready/go intro,
 * and the single well-defined exit path - so a stage module only implements the
 * gameplay itself.
 */
import Phaser from 'phaser';
import { installFallbackHandling, queueBundle } from './AssetLoader';
import { GameClock } from './GameClock';
import { Hud, type HudOptions } from './Hud';
import { ScoreManager } from './ScoreManager';
import type { StageContext, StageEndReason, StageResult } from './stageTypes';
import type { AssetBundleId } from '@/assets/assetTypes';
import type { AssetId } from '@/assets/assetRegistry';

const DEBUG_SNAPSHOT_INTERVAL_MS = 200;

export type StagePhase = 'loading' | 'intro' | 'playing' | 'ending';

export interface BaseStageOptions {
  readonly bundles: readonly AssetBundleId[];
  readonly hud: HudOptions;
  /** Total play time. Omit for stages that end on their own (e.g. a question count). */
  readonly timeLimitMs?: number;
  /** BGM started when play begins. */
  readonly bgm?: AssetId;
}

export abstract class BaseStageScene extends Phaser.Scene {
  protected readonly context: StageContext;
  protected readonly score: ScoreManager;
  protected readonly clock = new GameClock();
  protected hud!: Hud;
  protected phase: StagePhase = 'loading';

  private readonly options: BaseStageOptions;
  private finished = false;
  private debugAccumulator = 0;

  protected constructor(context: StageContext, options: BaseStageOptions) {
    super({ key: `stage:${context.stageId}` });
    this.context = context;
    this.options = options;
    this.score = new ScoreManager(context.stageId);
  }

  // -- Phaser lifecycle ----------------------------------------------------

  preload(): void {
    installFallbackHandling(this);
    for (const bundle of this.options.bundles) queueBundle(this.load, bundle);
  }

  create(): void {
    this.hud = new Hud(this, this.options.hud);
    this.createStage();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    this.phase = 'intro';
    this.runIntro();
  }

  update(_time: number, delta: number): void {
    if (this.phase !== 'playing') return;

    const dt = this.clock.tick(delta);
    this.updateStage(dt);

    const limit = this.options.timeLimitMs;
    if (limit !== undefined && this.clock.hasExpired(limit) && !this.finished) {
      this.finish('timeUp');
      return;
    }

    this.hud.update({
      score: this.score.score,
      elapsedMs: this.clock.elapsedMs,
      combo: this.score.combo,
    });

    this.emitDebugSnapshot(dt);
  }

  // -- Stage hooks ---------------------------------------------------------

  /** Build the world. Called once, after assets are ready. */
  protected abstract createStage(): void;

  /** Advance gameplay. `deltaMs` is already clamped and pause-aware. */
  protected abstract updateStage(deltaMs: number): void;

  /**
   * Last chance to write metrics before the result is produced (e.g. remaining time).
   * Anything the score formula reads must be present by the time this returns.
   */
  protected finalizeMetrics(_reason: StageEndReason): void {}

  /** Optional extra state for the debug overlay. */
  protected debugState(): { state?: string; extra?: Record<string, string | number> } {
    return {};
  }

  // -- Flow ----------------------------------------------------------------

  private runIntro(): void {
    const steps = ['3', '2', '1'];
    steps.forEach((text, index) => {
      this.time.delayedCall(index * 420, () => {
        if (!this.scene.isActive()) return;
        this.context.services.playSe('common.se.countdown');
        this.hud.banner(text, { durationMs: 160 });
      });
    });

    this.time.delayedCall(steps.length * 420, () => {
      if (!this.scene.isActive()) return;
      this.context.services.playSe('common.se.start');
      this.hud.banner('GO!', { color: '#ffd45e', durationMs: 320 });
      if (this.options.bgm) this.context.services.playBgm(this.options.bgm);
      this.clock.start();
      this.phase = 'playing';
      this.onPlayStart();
    });
  }

  /** Called the moment play actually begins (after the countdown). */
  protected onPlayStart(): void {}

  /**
   * Ends the stage. Safe to call more than once - only the first call counts, which
   * removes a whole class of double-submit bugs.
   */
  protected finish(reason: StageEndReason): void {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'ending';
    this.clock.stop();

    this.finalizeMetrics(reason);
    this.context.services.stopBgm(300);

    const result: StageResult = {
      stageId: this.context.stageId,
      score: this.score.score,
      durationMs: Math.round(this.clock.elapsedMs),
      metrics: this.score.metrics,
      events: {
        seed: this.context.seed,
        rngDraws: this.context.rng.drawn,
      },
    };

    // Let the last frame of feedback play before handing control back to React.
    this.time.delayedCall(reason === 'abort' ? 0 : 700, () => {
      this.context.onComplete({ result, reason });
    });
  }

  /** Aborts immediately, discarding the result (used when the player quits). */
  abortStage(): void {
    this.finish('abort');
  }

  pauseStage(): void {
    if (this.phase !== 'playing') return;
    this.clock.pause();
    this.scene.pause();
  }

  resumeStage(): void {
    if (this.phase !== 'playing') return;
    this.scene.resume();
    this.clock.resume();
  }

  protected get timeLimitMs(): number {
    return this.options.timeLimitMs ?? Number.POSITIVE_INFINITY;
  }

  private emitDebugSnapshot(deltaMs: number): void {
    if (!this.context.debug || !this.context.onDebugSnapshot) return;
    this.debugAccumulator += deltaMs;
    if (this.debugAccumulator < DEBUG_SNAPSHOT_INTERVAL_MS) return;
    this.debugAccumulator = 0;

    const extra = this.debugState();
    this.context.onDebugSnapshot({
      score: this.score.score,
      timeLeftMs: this.options.timeLimitMs
        ? this.clock.remainingMs(this.options.timeLimitMs)
        : this.clock.elapsedMs,
      combo: this.score.combo,
      state: extra.state,
      extra: extra.extra,
    });
  }

  private teardown(): void {
    this.score.destroy();
    this.hud?.destroy();
  }
}
