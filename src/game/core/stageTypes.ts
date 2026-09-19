/**
 * The stage contract.
 *
 * Everything the rest of the app knows about a mini-game lives behind these types.
 * Adding a fourth stage means writing one module that satisfies `StageModule` and
 * registering it - no changes to the app shell, the result screens, the submission
 * pipeline or the leaderboard.
 *
 * `import type` only: this file must stay loadable by the React UI without pulling
 * Phaser into the initial bundle.
 */
import type Phaser from 'phaser';
import type { AssetBundleId } from '@/assets/assetTypes';
import type { AssetId } from '@/assets/assetRegistry';
import type { StageId } from '@/config/rules';
import type { Rng } from '@/utils/rng';

export type { StageId };

/**
 * The result of one stage. This exact shape is what gets POSTed to the backend,
 * where the score is recomputed from `metrics` and compared.
 */
export interface StageResult {
  readonly stageId: StageId;
  /** Client-side score. Informational only - the server recomputes it. */
  readonly score: number;
  readonly durationMs: number;
  /** Flat numeric map. The server's score formula reads exactly these keys. */
  readonly metrics: Readonly<Record<string, number>>;
  /** Optional non-scoring telemetry, useful for balancing. Never affects score. */
  readonly events?: GameEventSummary;
}

export interface GameEventSummary {
  readonly [key: string]: number | string;
}

/** Reason a stage ended. `abort` results are discarded rather than submitted. */
export type StageEndReason = 'cleared' | 'timeUp' | 'abort';

export interface StageCompletion {
  readonly result: StageResult;
  readonly reason: StageEndReason;
}

/** Audio/haptic/debug services handed to a stage. Kept narrow on purpose. */
export interface StageServices {
  /** `pan` (-1..1) positions a sound left/right; ignored where unsupported. */
  playSe(id: AssetId, options?: { volume?: number; rate?: number; pan?: number }): void;
  playBgm(id: AssetId): void;
  stopBgm(fadeMs?: number): void;
  vibrate(pattern: number | number[]): void;
}

/**
 * Everything a stage scene needs. Constructed by the game host, never by the stage.
 */
export interface StageContext {
  readonly stageId: StageId;
  /** Seed derived from the run seed - deterministic per (run, stage). */
  readonly seed: number;
  readonly rng: Rng;
  readonly services: StageServices;
  readonly debug: boolean;
  /** Multiplier applied by the remote game config (ops lever, default 1). */
  readonly difficultyScale: number;
  /** Called exactly once when the stage finishes. */
  onComplete(completion: StageCompletion): void;
  /**
   * Low-frequency HUD mirror for the debug overlay. NEVER call this per frame from
   * gameplay code - the in-game HUD is drawn inside Phaser.
   */
  onDebugSnapshot?(snapshot: StageDebugSnapshot): void;
}

export interface StageDebugSnapshot {
  readonly score: number;
  readonly timeLeftMs: number;
  readonly combo: number;
  readonly state?: string;
  readonly extra?: Readonly<Record<string, string | number>>;
}

/** A stage scene is just a Phaser scene with a known key. */
export type StageSceneFactory = (context: StageContext) => Phaser.Scene;

export interface StageMetricDisplay {
  readonly label: string;
  readonly value: string;
}

/**
 * A registered mini-game.
 *
 * `loadScene` is async so each stage's Phaser code is a separate chunk and can be
 * background-preloaded while the player is on an earlier screen.
 */
export interface StageModule {
  readonly id: StageId;
  /** Shown on the intro / result screens. */
  readonly label: string;
  /**
   * A few characters, for places where the full label will not fit - currently the
   * leaderboard's stage tabs, where four of them share one phone-width row.
   *
   * Required rather than falling back to `label`, so adding a fifth mini-game asks
   * the question up front instead of quietly breaking that row.
   */
  readonly shortLabel: string;
  readonly tagline: string;
  /** One line per rule, shown on the stage intro screen. */
  readonly rules: readonly string[];
  /** How to play, shown under the rules. */
  readonly controlHint: string;
  /** Asset bundles this stage needs before it can start. */
  readonly bundles: readonly AssetBundleId[];
  /** Feature flag - a broken stage can be dropped from production without a code change. */
  readonly enabled: boolean;
  /** Approximate play time, used for the loading/intro copy. */
  readonly approxDurationSec: number;
  loadScene(): Promise<StageSceneFactory>;
  /**
   * Turns raw metrics into rows for the result screen, so result UI stays generic.
   */
  formatMetrics(metrics: Readonly<Record<string, number>>): readonly StageMetricDisplay[];
  /**
   * Plausible result used by the dev-only "skip stage" button, so skipping still
   * produces a submission the validator accepts. Never called in production.
   */
  debugSampleResult?(): StageResult;
}
