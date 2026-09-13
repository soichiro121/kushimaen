/**
 * STAGE 3 - map data model.
 *
 * THE POINT OF THIS FILE: the school is *data*, not code. A Phaser scene that hard
 * codes a floor plan cannot be replaced later without rewriting the game, so the
 * layout lives in plain objects that anyone can edit (or generate from a real
 * floor plan) while `TeacherScene` stays untouched.
 *
 * Geometry model - deliberately the simplest thing that supports stealth:
 *
 *   - Everything is an axis-aligned rectangle in world pixels.
 *   - `walls` are SOLID: they block movement *and* line of sight. That single list
 *     is what makes corners, occlusion and dead ends work.
 *   - `areas` are walkable regions. They carry the floor look and the room name, and
 *     are used for the map painting and the "where am I" audio hints. They are NOT
 *     collision: walkable = inside `bounds`, outside every wall.
 *   - `waypoints` + `edges` are the patrol graph. Teachers only ever walk along an
 *     edge, so no pathfinding library is needed (see docs/GAME_DESIGN.md).
 *
 * A test asserts that every edge is wall-free and that every checkpoint, waypoint
 * and spawn point stands on walkable ground, so an authoring slip fails in CI
 * rather than trapping a player inside a wall.
 */
import type { AssetId } from '@/assets/assetRegistry';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Decides which floor texture an area is painted with. */
export type AreaKind = 'corridor' | 'classroom' | 'stairs' | 'lobby' | 'room';

export interface MapArea {
  readonly id: string;
  /** Shown in the HUD and used for the "next objective" label. */
  readonly name: string;
  readonly kind: AreaKind;
  readonly rect: Rect;
}

/** A solid block: blocks walking and blocks sight. */
export interface MapWall {
  readonly rect: Rect;
  /** Optional label, purely to keep the data file readable. */
  readonly note?: string;
}

export interface MapWaypoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** An undirected connection between two waypoints. Must not cross a wall. */
export type MapEdge = readonly [from: string, to: string];

export type CheckpointKind = 'objective' | 'exit';

export interface MapCheckpoint {
  readonly id: string;
  /** Shown as `NEXT <name>` in the HUD. Swap freely - nothing keys off it. */
  readonly name: string;
  readonly kind: CheckpointKind;
  readonly x: number;
  readonly y: number;
  /** Area this checkpoint sits in, used for the arrival banner. */
  readonly areaId: string;
}

/** Behaviour archetypes. Tuning per type lives in `teacherConfig.teacherTypes`. */
export type TeacherTypeId = 'normal' | 'stander' | 'looker' | 'roomer';

export interface MapPatrol {
  readonly id: string;
  readonly typeId: TeacherTypeId;
  /**
   * Waypoint ids walked in order and then back again (A-B-C-D-C-B-A).
   * Consecutive ids must be connected by an edge.
   */
  readonly route: readonly string[];
  /** Waypoint ids where this teacher stops and looks around. */
  readonly waitAt?: readonly string[];
  /** Index into `route` the teacher starts at. Keeps spawns away from the player. */
  readonly startIndex?: number;
  /**
   * Seeded start offset, in units of "fraction of the first leg". A small range
   * keeps the patrol learnable while stopping every run from being identical.
   */
  readonly startPhaseRange?: readonly [min: number, max: number];
}

/**
 * A mission is an ordered list of checkpoint ids. The last one must be the exit.
 * `alternatives` gives the seeded variation: one entry may be swapped per run.
 */
export interface MissionPattern {
  readonly id: string;
  readonly label: string;
  readonly checkpoints: readonly string[];
  /** `index` in `checkpoints` may be replaced by one of `options`. */
  readonly alternatives?: readonly {
    readonly index: number;
    readonly options: readonly string[];
  }[];
}

export interface SchoolMapData {
  readonly id: string;
  readonly name: string;
  /** Outer playable rectangle. The player is clamped inside it. */
  readonly bounds: Rect;
  readonly areas: readonly MapArea[];
  readonly walls: readonly MapWall[];
  readonly waypoints: readonly MapWaypoint[];
  readonly edges: readonly MapEdge[];
  readonly checkpoints: readonly MapCheckpoint[];
  readonly patrols: readonly MapPatrol[];
  readonly missions: readonly MissionPattern[];
  readonly spawn: Point;
  /** Floor artwork per area kind. Swapping the school look = change these ids. */
  readonly floorAssets: Readonly<Record<AreaKind, AssetId>>;
  readonly wallAsset: AssetId;
}
