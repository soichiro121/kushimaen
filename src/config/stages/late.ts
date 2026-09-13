/**
 * STAGE 1 - 遅刻回避 (dodge the crowd on the way to school): tuning values.
 *
 * Everything a designer would want to change lives here. Gameplay code reads this
 * object and contains no magic numbers.
 *
 * Score-affecting constants are NOT here - they live in `shared/game-rules/vN.json`
 * because the PHP backend has to agree with them.
 */
import { RULES } from '@/config/rules';
import type { AssetId } from '@/assets/assetRegistry';

export type ObstacleBehavior = 'straight' | 'oscillate' | 'swerve';

export interface ObstacleKind {
  readonly id: string;
  /** Spritesheet (animated) or image (static group) - the registry sorts it out. */
  readonly assetId: AssetId;
  readonly animated: boolean;
  /** Relative spawn weight. Increase to see a kind more often. */
  readonly weight: number;
  /** Display width in CSS px; height follows the asset's aspect ratio. */
  readonly displayWidth: number;
  /** Hit box width as a fraction of the display width (people are not rectangles). */
  readonly hitboxScale: number;
  /** Downward speed as a multiple of the current scroll speed. */
  readonly speedFactor: number;
  readonly behavior: ObstacleBehavior;
  /** `oscillate`: horizontal amplitude in px and period in ms. */
  readonly oscillateAmplitude?: number;
  readonly oscillatePeriodMs?: number;
  /** `swerve`: how far it lurches sideways and how long the lurch takes. */
  readonly swerveDistance?: number;
  readonly swerveDurationMs?: number;
}

export const lateConfig = {
  timeLimitMs: RULES.stages.late.timeLimitSec * 1000,

  /**
   * Total course length. Reaching it spawns the gate and ends the stage.
   * Tuned so a clean run finishes with a few seconds to spare: short enough that the
   * gate is reachable, long enough that collisions (which slow you down) can
   * genuinely cost the time bonus.
   */
  courseDistancePx: 18000,

  /** Scroll speed ramps from `start` to `end` across the course (px/sec). */
  scroll: {
    startSpeed: 520,
    endSpeed: 820,
  },

  road: {
    /**
     * Playable width as a fraction of the viewport.
     * The road drawn in `late.background.privateRoad` must occupy this same central
     * fraction of the image, otherwise the player will appear to run onto the walls.
     * See docs/ASSETS.md.
     */
    widthRatio: 0.74,
    /** Extra inset so the player cannot hug the wall texture. */
    edgePadding: 18,
  },

  player: {
    /** Vertical position as a fraction of the viewport height. */
    yRatio: 0.76,
    displayWidth: 76,
    /**
     * Finger travel is multiplied by this. The character follows the *delta* of the
     * drag, never the absolute finger position, so it is never hidden under the thumb.
     */
    dragSensitivity: 1.45,
    /** Exponential smoothing factor per 16ms frame (0-1). Higher = snappier. */
    smoothing: 0.42,
    /** Hit radius in px. */
    hitboxRadius: 22,
  },

  collision: {
    /** Scroll speed multiplier while staggered. */
    slowdownFactor: 0.42,
    slowdownMs: 900,
    /** Grace period after a hit so one crowd cannot chain-hit the player. */
    invulnerableMs: 850,
  },

  nearMiss: {
    /** Horizontal gap (px) at the moment of passing that still counts as a near miss. */
    distancePx: 74,
    /** Distance under which it is a collision rather than a near miss. */
    minDistancePx: 30,
  },

  /** Vertical tolerance (px) used by the collision test. */
  hit: {
    verticalTolerancePx: 46,
  },

  spawn: {
    /** Spawn interval interpolates from `startMs` to `endMs` across the course. */
    startMs: 820,
    endMs: 430,
    /** Minimum vertical gap between consecutive spawns, in px of scroll. */
    minGapPx: 190,
  },

  /** Decorative props along the road edges. */
  props: {
    assetId: 'late.prop.roadside' as AssetId,
    intervalPx: 320,
    displayWidth: 62,
  },

  gate: {
    assetId: 'late.background.gate' as AssetId,
    displayWidthRatio: 1,
  },

  obstacles: [
    {
      id: 'normal01',
      assetId: 'late.student.normal01',
      animated: true,
      weight: 26,
      displayWidth: 64,
      hitboxScale: 0.52,
      speedFactor: 0.72,
      behavior: 'straight',
    },
    {
      id: 'normal02',
      assetId: 'late.student.normal02',
      animated: true,
      weight: 24,
      displayWidth: 64,
      hitboxScale: 0.52,
      speedFactor: 0.78,
      behavior: 'straight',
    },
    {
      id: 'hurry',
      assetId: 'late.student.hurry',
      animated: true,
      weight: 16,
      displayWidth: 62,
      hitboxScale: 0.5,
      speedFactor: 1.22,
      behavior: 'straight',
    },
    {
      id: 'wanderer',
      assetId: 'late.student.wanderer',
      animated: true,
      weight: 14,
      displayWidth: 64,
      hitboxScale: 0.52,
      speedFactor: 0.8,
      behavior: 'oscillate',
      oscillateAmplitude: 56,
      oscillatePeriodMs: 1700,
    },
    {
      id: 'swerve',
      assetId: 'late.student.swerve',
      animated: true,
      weight: 12,
      displayWidth: 64,
      hitboxScale: 0.52,
      speedFactor: 0.86,
      behavior: 'swerve',
      swerveDistance: 92,
      swerveDurationMs: 520,
    },
    {
      id: 'pair',
      assetId: 'late.student.pair',
      animated: false,
      weight: 10,
      displayWidth: 118,
      hitboxScale: 0.82,
      speedFactor: 0.68,
      behavior: 'straight',
    },
    {
      id: 'trio',
      assetId: 'late.student.trio',
      animated: false,
      weight: 6,
      displayWidth: 168,
      hitboxScale: 0.86,
      speedFactor: 0.62,
      behavior: 'straight',
    },
  ] satisfies readonly ObstacleKind[],
} as const;

export type LateConfig = typeof lateConfig;
