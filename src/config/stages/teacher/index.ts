/**
 * STAGE 3 - 放課後ステルス: tuning values.
 *
 * Everything a designer would want to change lives here; the scene contains no
 * magic numbers. Score constants are NOT here - they live in
 * `shared/game-rules/vN.json` because the API has to agree with them.
 *
 * The school layout is data too, in `./maps/`.
 */
import { RULES } from '@/config/rules';
import type { AssetId } from '@/assets/assetRegistry';
import type { TeacherTypeId } from './mapTypes';

export * from './mapTypes';
export { SCHOOL_MAPS, DEFAULT_MAP_ID, getSchoolMap, allSchoolMaps } from './maps';
export type { SchoolMapId } from './maps';

/** Per-archetype behaviour. Requirement 15: at least three distinct teachers. */
export interface TeacherTypeConfig {
  readonly id: TeacherTypeId;
  /** Shown in the debug overlay and in docs. */
  readonly label: string;
  readonly speedPxPerSec: number;
  /** How far the teacher can see, in world px. */
  readonly viewDistancePx: number;
  /** Full cone width in degrees (the half-angle is derived). */
  readonly viewAngleDeg: number;
  /** How long they stand still at a `waitAt` waypoint. */
  readonly waitMs: { readonly minMs: number; readonly maxMs: number };
  /** Chance, per arrival at a waypoint, of stopping to look the other way. */
  readonly turnProbability: number;
  /** Degrees per second while turning or scanning. */
  readonly turnSpeedDegPerSec: number;
  /** While waiting, sweep the head by +-this many degrees. 0 = stare straight ahead. */
  readonly scanArcDeg: number;
  /** Tint applied to the placeholder sprite so the types read apart at a glance. */
  readonly tint: number;
}

export const teacherConfig = {
  timeLimitMs: RULES.stages.teacher.timeLimitSec * 1000,

  /**
   * What the intro screen promises. NOT the time limit: the 90-second limit is a
   * safety net so a stuck player can still finish, while a normal run is about this
   * long (measured with `npm run balance`). Showing the limit here would tell every
   * player the stage takes twice as long as it does.
   */
  approxDurationSec: 50,

  map: {
    /** Fraction of the viewport the camera shows (lower = more of the map visible). */
    cameraZoom: 0.8,
    /** How far ahead of the player the camera leads, in px at full speed. */
    lookAheadPx: 120,
    /** Camera follow smoothing (Phaser lerp, per axis). */
    followLerp: 0.12,
  },

  player: {
    speedPxPerSec: 300,
    radiusPx: 17,
    /** Acceleration smoothing per 16ms frame (0-1). Higher = snappier, less floaty. */
    smoothing: 0.3,
    displayWidth: 46,
    /** Distance at which a checkpoint is collected automatically (requirement 10). */
    checkpointRadiusPx: 62,
  },

  input: {
    /** Finger travel below this is treated as "not moving" - stops thumb jitter. */
    deadZonePx: 12,
    /** Finger travel at which the player reaches full speed. */
    fullSpeedPx: 78,
    /**
     * The anchor is dragged along once the finger goes further than this, so a long
     * swipe never leaves the stick "stuck" at the rim.
     */
    maxOffsetPx: 108,
    /**
     * Fraction of the screen height, measured from the bottom, that is reserved for
     * steering. Touches above it still steer, but this band is where the on-screen
     * hint is drawn so the player knows their thumb will not cover the map.
     */
    controlBandRatio: 0.3,
  },

  vision: {
    /**
     * Faint cone rendering. Requirement 18: visible by default (it teaches the
     * mechanic), switchable so a later difficulty can hide it.
     */
    showVisionCone: true,
    /** Alpha of the cone fill at the teacher, fading to 0 at the far edge. */
    coneAlpha: 0.16,
    /** Fraction of the view distance drawn solid before the fade starts. */
    coneSolidRatio: 0.45,
    /** Rays used to draw the cone outline. Kept low - this redraws every frame. */
    coneSegments: 9,
  },

  detection: {
    /**
     * Time inside a cone before the player is caught (requirement 20), measured at
     * the FAR edge of the cone. Point-blank it is `fillMs / closeRangeBoost`, i.e.
     * a little under half a second.
     *
     * Why the far edge is SO slow: breaking line of sight in a corridor means
     * reaching the next doorway, 300-600px away, which takes one to two seconds. A
     * flat half-second would turn every sighting into a guaranteed catch - the
     * balance run showed exactly that, and with it "never take the fast route".
     *
     * Distance is therefore the real currency of this stage: walking past a teacher
     * at arm's length is fatal, crossing the far end of their cone costs you the
     * perfect-stealth bonus but not the run.
     */
    fillMs: 1400,
    /** Being close makes it far faster: multiplier at point-blank range. */
    closeRangeBoost: 4.5,
    /** Meter drain once sight is broken, so ducking round a corner saves you. */
    decayMs: 600,
    /** Grace before the meter starts draining, so brushing the edge still stings. */
    decayDelayMs: 250,
    /** Meter level that counts as "spotted" for the perfect-stealth bonus. */
    alertRatio: 0.5,
  },

  caught: {
    /** Frozen in place after being caught. This IS the time penalty. */
    freezeMs: 1500,
    /**
     * How far back a catch sends you, at most.
     *
     * Requirement 22 asks for a return to the last safe checkpoint. Taken literally
     * that can undo a 2000px leg, and the balance run showed the result: taking the
     * fast route was never worth it, because one catch cost more time than all the
     * waiting it saved. So the setback is bounded - you are pushed back to the
     * furthest patrol-graph node within this radius that the teacher who caught you
     * cannot currently see, and only fall back to the last checkpoint if there is
     * no such spot. The sting stays in the clock and the score, where it belongs.
     */
    maxSetbackPx: 620,
    /** Immunity after respawning, so one teacher cannot chain-catch you. */
    graceMs: 1400,
    /** How long 「おい」 stays up. Requirement 63-G: short. */
    bannerMs: 1100,
  },

  danger: {
    /** Passing this close to a teacher earns the danger bonus. */
    distancePx: 170,
    /**
     * Anti-farm (requirement 32): each teacher can pay out only once per objective
     * leg, and only while that teacher is actually on the move and facing roughly
     * the player's way. Circling someone in a corner earns nothing.
     */
    maxFacingAngleDeg: 110,
    cooldownMs: 2500,
  },

  audio: {
    /** Footstep interval while a teacher is walking. */
    teacherStepMs: 520,
    /** Beyond this the teacher is inaudible; volume falls off linearly to it. */
    hearingRangePx: 980,
    /** Volume at zero distance. */
    maxVolume: 0.5,
    /** Player's own footsteps. */
    playerStepMs: 300,
    playerStepVolume: 0.22,
    /** Off-screen teachers within hearing range get a small edge marker. */
    showOffscreenMarkers: true,
  },

  hud: {
    /** Radius of the "next objective" arrow around the player, in screen px. */
    compassRadiusPx: 92,
    /** The arrow hides when the objective is already comfortably on screen. */
    compassHideMarginPx: 60,
  },

  /**
   * Requirement 53: the first moments must be calm.
   *
   * No teacher may start within `safeSpawnRadiusPx` of the spawn point, AND none may
   * see it during the first `openingGraceMs` of play. Both are asserted by a test
   * rather than eyeballed - the first version of the map had the exit guard loitering
   * just outside the entrance hall, which made stepping out of the door a coin flip.
   */
  safeSpawnRadiusPx: 450,
  openingGraceMs: 3200,

  /** Requirement 15. Four archetypes; the map decides which ones are on duty. */
  teacherTypes: {
    normal: {
      id: 'normal',
      label: '普通（一定ルート）',
      speedPxPerSec: 118,
      viewDistancePx: 350,
      viewAngleDeg: 72,
      waitMs: { minMs: 500, maxMs: 900 },
      turnProbability: 0.12,
      turnSpeedDegPerSec: 260,
      scanArcDeg: 0,
      tint: 0xe0e4ee,
    },
    stander: {
      id: 'stander',
      label: '立ち止まって見回す',
      speedPxPerSec: 96,
      viewDistancePx: 380,
      viewAngleDeg: 66,
      waitMs: { minMs: 1900, maxMs: 3200 },
      turnProbability: 0.2,
      turnSpeedDegPerSec: 150,
      scanArcDeg: 75,
      tint: 0xa8d8ff,
    },
    looker: {
      id: 'looker',
      label: '時々振り返る',
      speedPxPerSec: 112,
      viewDistancePx: 330,
      viewAngleDeg: 78,
      waitMs: { minMs: 350, maxMs: 700 },
      turnProbability: 0.55,
      turnSpeedDegPerSec: 300,
      scanArcDeg: 0,
      tint: 0xffc2a8,
    },
    roomer: {
      id: 'roomer',
      label: '部屋から急に出る',
      speedPxPerSec: 132,
      viewDistancePx: 340,
      viewAngleDeg: 70,
      waitMs: { minMs: 2600, maxMs: 4600 },
      turnProbability: 0.1,
      turnSpeedDegPerSec: 280,
      scanArcDeg: 40,
      tint: 0xd8b6ff,
    },
  } satisfies Record<TeacherTypeId, TeacherTypeConfig>,

  /** After losing sight of the player, walk to where they were last seen. */
  investigate: {
    /** Only investigate if the meter got at least this high. */
    triggerRatio: 0.45,
    /** Give up after this long and walk back to the route. */
    timeoutMs: 3600,
    /** Close enough to the last-known point to call it searched. */
    arriveRadiusPx: 70,
    /** Speed multiplier while investigating - a little brisker than patrolling. */
    speedScale: 1.22,
  },

  assets: {
    playerWalk: 'teacher.player.walk' as AssetId,
    playerIdle: 'teacher.player.idle' as AssetId,
    npcWalk: 'teacher.npc.walk' as AssetId,
    npcWait: 'teacher.npc.wait' as AssetId,
    npcAlert: 'teacher.npc.alert' as AssetId,
    objectiveMarker: 'teacher.objective.marker' as AssetId,
    exitMarker: 'teacher.objective.exit' as AssetId,
    alertBubble: 'teacher.fx.alert' as AssetId,
    bgm: 'teacher.bgm.main' as AssetId,
    se: {
      playerStep: 'teacher.se.footstep' as AssetId,
      teacherStep: 'teacher.se.teacherFootstep' as AssetId,
      door: 'teacher.se.door' as AssetId,
      detect: 'teacher.se.detect' as AssetId,
      caught: 'teacher.se.caught' as AssetId,
      checkpoint: 'teacher.se.checkpoint' as AssetId,
      clear: 'teacher.se.clear' as AssetId,
    },
  },
} as const;

export type TeacherConfig = typeof teacherConfig;
