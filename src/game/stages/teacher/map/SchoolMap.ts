/**
 * Runtime model of a `SchoolMapData`.
 *
 * Turns the authored data into the three queries the stage actually needs:
 *
 *   move()      - slide a circle through the building without leaving it
 *   hasLineOfSight() - can A see B, or is there a wall in the way
 *   waypoint()/area() - lookups for the patrol graph and the HUD
 *
 * Phaser-free, so the whole stealth model is unit-testable and can be driven by the
 * balance simulator (`npm run balance`) without a renderer.
 *
 * Performance note: the map has a few dozen walls and at most a handful of teachers,
 * so a linear scan with a bounding-box rejection is measurably faster than any index
 * we could build. Requirement 49 is met by *not* doing anything clever here.
 */
import type {
  MapArea,
  MapCheckpoint,
  MapWaypoint,
  Point,
  Rect,
  SchoolMapData,
} from '@/config/stages/teacher';
import {
  circleIntersectsRect,
  clamp,
  pointInRect,
  rectBottom,
  rectRight,
  segmentBoundsOverlapRect,
  segmentIntersectsRect,
} from './geometry';

/**
 * Longest distance resolved in one collision test. Must stay below the thinnest wall
 * in any map (the door partitions are 24px) or a fast body can tunnel through one.
 */
const MAX_SUBSTEP_PX = 8;

export interface MoveResult {
  readonly x: number;
  readonly y: number;
  /** True when a wall stopped part of the requested movement. */
  readonly blocked: boolean;
}

export class SchoolMap {
  readonly data: SchoolMapData;
  private readonly wallRects: readonly Rect[];
  private readonly waypointsById: ReadonlyMap<string, MapWaypoint>;
  private readonly checkpointsById: ReadonlyMap<string, MapCheckpoint>;
  private readonly areasById: ReadonlyMap<string, MapArea>;
  private readonly neighbours: ReadonlyMap<string, readonly string[]>;

  constructor(data: SchoolMapData) {
    this.data = data;
    this.wallRects = data.walls.map((wall) => wall.rect);
    this.waypointsById = new Map(data.waypoints.map((node) => [node.id, node]));
    this.checkpointsById = new Map(data.checkpoints.map((node) => [node.id, node]));
    this.areasById = new Map(data.areas.map((area) => [area.id, area]));

    const adjacency = new Map<string, string[]>();
    for (const [from, to] of data.edges) {
      (adjacency.get(from) ?? adjacency.set(from, []).get(from)!).push(to);
      (adjacency.get(to) ?? adjacency.set(to, []).get(to)!).push(from);
    }
    this.neighbours = adjacency;
  }

  get bounds(): Rect {
    return this.data.bounds;
  }

  get walls(): readonly Rect[] {
    return this.wallRects;
  }

  // -- lookups --------------------------------------------------------------

  waypoint(id: string): MapWaypoint {
    const node = this.waypointsById.get(id);
    if (!node) throw new Error(`Unknown waypoint "${id}" in map "${this.data.id}"`);
    return node;
  }

  checkpoint(id: string): MapCheckpoint {
    const node = this.checkpointsById.get(id);
    if (!node) throw new Error(`Unknown checkpoint "${id}" in map "${this.data.id}"`);
    return node;
  }

  area(id: string): MapArea {
    const area = this.areasById.get(id);
    if (!area) throw new Error(`Unknown area "${id}" in map "${this.data.id}"`);
    return area;
  }

  neighboursOf(id: string): readonly string[] {
    return this.neighbours.get(id) ?? [];
  }

  areEdgeConnected(a: string, b: string): boolean {
    return this.neighboursOf(a).includes(b);
  }

  /** The patrol-graph node closest to a world point. */
  nearestWaypointId(x: number, y: number): string {
    let best = this.data.waypoints[0]?.id ?? '';
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const node of this.data.waypoints) {
      const dx = node.x - x;
      const dy = node.y - y;
      const squared = dx * dx + dy * dy;
      if (squared < bestDistance) {
        bestDistance = squared;
        best = node.id;
      }
    }
    return best;
  }

  /**
   * Shortest node path between two waypoints, `from` excluded.
   *
   * Breadth-first over the authored graph. Requirement 48: the patrol graph is all
   * the navigation this stage needs, so there is no nav-mesh and no library - a
   * teacher walking off to investigate simply follows edges like it does on patrol.
   */
  findPath(from: string, to: string): readonly string[] {
    if (from === to) return [];

    const previous = new Map<string, string>([[from, from]]);
    const queue: string[] = [from];

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head] as string;
      if (current === to) break;
      for (const next of this.neighboursOf(current)) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        queue.push(next);
      }
    }

    if (!previous.has(to)) return [];

    const path: string[] = [];
    let cursor = to;
    while (cursor !== from) {
      path.push(cursor);
      cursor = previous.get(cursor) as string;
    }
    return path.reverse();
  }

  /** The area a world point stands in, or null when it is inside a wall. */
  areaAt(x: number, y: number): MapArea | null {
    for (const area of this.data.areas) {
      if (pointInRect(x, y, area.rect)) return area;
    }
    return null;
  }

  // -- collision ------------------------------------------------------------

  /** True when a circle of `radius` at (x, y) is clear of every wall and inside bounds. */
  isWalkable(x: number, y: number, radius: number): boolean {
    const { bounds } = this.data;
    if (
      x - radius < bounds.x ||
      y - radius < bounds.y ||
      x + radius > rectRight(bounds) ||
      y + radius > rectBottom(bounds)
    ) {
      return false;
    }
    for (const rect of this.wallRects) {
      if (circleIntersectsRect(x, y, radius, rect)) return false;
    }
    return true;
  }

  /**
   * Slides a circle from (x, y) by (dx, dy).
   *
   * Each axis is resolved separately, which is what produces the "slide along the
   * wall" feel: pushing diagonally into a corridor wall still moves you forward
   * instead of sticking.
   *
   * The movement is SUB-STEPPED. Resolving a whole frame's travel in one test would
   * let a long step jump clean over a thin wall - the door partitions here are only
   * 24px thick, and a frame hitch (the clock clamps at 100ms) is 30px of travel. A
   * test caught exactly that, so the step is capped below the thinnest wall.
   */
  move(x: number, y: number, dx: number, dy: number, radius: number): MoveResult {
    const distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP_PX));
    if (steps === 1) return this.moveStep(x, y, dx, dy, radius);

    let current: MoveResult = { x, y, blocked: false };
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      current = this.moveStep(current.x, current.y, dx / steps, dy / steps, radius);
      blocked = blocked || current.blocked;
    }
    return { x: current.x, y: current.y, blocked };
  }

  private moveStep(x: number, y: number, dx: number, dy: number, radius: number): MoveResult {
    let blocked = false;

    let nextX = x + dx;
    if (dx !== 0) {
      const resolved = this.resolveAxis(nextX, y, radius, 'x');
      if (resolved !== nextX) blocked = true;
      nextX = resolved;
    }

    let nextY = y + dy;
    if (dy !== 0) {
      const resolved = this.resolveAxis(nextX, nextY, radius, 'y');
      if (resolved !== nextY) blocked = true;
      nextY = resolved;
    }

    const { bounds } = this.data;
    const clampedX = clamp(nextX, bounds.x + radius, rectRight(bounds) - radius);
    const clampedY = clamp(nextY, bounds.y + radius, rectBottom(bounds) - radius);
    if (clampedX !== nextX || clampedY !== nextY) blocked = true;

    return { x: clampedX, y: clampedY, blocked };
  }

  /** Pushes a circle out of every wall it overlaps along one axis. */
  private resolveAxis(x: number, y: number, radius: number, axis: 'x' | 'y'): number {
    let value = axis === 'x' ? x : y;

    for (const rect of this.wallRects) {
      const testX = axis === 'x' ? value : x;
      const testY = axis === 'x' ? y : value;
      if (!circleIntersectsRect(testX, testY, radius, rect)) continue;

      if (axis === 'x') {
        const fromLeft = rect.x - radius;
        const fromRight = rectRight(rect) + radius;
        value = value - fromLeft < fromRight - value ? fromLeft : fromRight;
      } else {
        const fromTop = rect.y - radius;
        const fromBottom = rectBottom(rect) + radius;
        value = value - fromTop < fromBottom - value ? fromTop : fromBottom;
      }
    }
    return value;
  }

  // -- sight ----------------------------------------------------------------

  /**
   * True when nothing solid stands between the two points.
   *
   * This is what stops a teacher seeing through a classroom wall (requirement 17)
   * and what makes ducking round a corner a real escape (requirement 20).
   */
  hasLineOfSight(from: Point, to: Point): boolean {
    for (const rect of this.wallRects) {
      if (!segmentBoundsOverlapRect(from.x, from.y, to.x, to.y, rect)) continue;
      if (segmentIntersectsRect(from.x, from.y, to.x, to.y, rect)) return false;
    }
    return true;
  }
}

export interface MapValidationIssue {
  readonly code: string;
  readonly detail: string;
}

/**
 * Structural checks on authored map data.
 *
 * Run by the test suite for every registered map, so a typo in a coordinate fails in
 * CI instead of trapping a player inside a wall on a phone.
 */
export function validateSchoolMap(data: SchoolMapData, playerRadius: number): MapValidationIssue[] {
  const map = new SchoolMap(data);
  const issues: MapValidationIssue[] = [];

  const known = new Set(data.waypoints.map((node) => node.id));
  const seen = new Set<string>();
  for (const node of data.waypoints) {
    if (seen.has(node.id)) issues.push({ code: 'duplicate_waypoint', detail: node.id });
    seen.add(node.id);
    if (!map.isWalkable(node.x, node.y, playerRadius)) {
      issues.push({ code: 'waypoint_in_wall', detail: node.id });
    }
    if (!map.areaAt(node.x, node.y)) {
      issues.push({ code: 'waypoint_outside_area', detail: node.id });
    }
  }

  for (const [from, to] of data.edges) {
    if (!known.has(from) || !known.has(to)) {
      issues.push({ code: 'edge_unknown_waypoint', detail: `${from}-${to}` });
      continue;
    }
    const a = map.waypoint(from);
    const b = map.waypoint(to);
    if (!isCorridorClear(map, a, b, playerRadius)) {
      issues.push({ code: 'edge_crosses_wall', detail: `${from}-${to}` });
    }
  }

  for (const checkpoint of data.checkpoints) {
    if (!map.isWalkable(checkpoint.x, checkpoint.y, playerRadius)) {
      issues.push({ code: 'checkpoint_in_wall', detail: checkpoint.id });
    }
    if (!map.areaAt(checkpoint.x, checkpoint.y)) {
      issues.push({ code: 'checkpoint_outside_area', detail: checkpoint.id });
    }
  }

  if (!map.isWalkable(data.spawn.x, data.spawn.y, playerRadius)) {
    issues.push({ code: 'spawn_in_wall', detail: `${data.spawn.x},${data.spawn.y}` });
  }

  for (const patrol of data.patrols) {
    if (patrol.route.length < 2) {
      issues.push({ code: 'patrol_too_short', detail: patrol.id });
    }
    for (let i = 1; i < patrol.route.length; i++) {
      const from = patrol.route[i - 1] as string;
      const to = patrol.route[i] as string;
      if (!map.areEdgeConnected(from, to)) {
        issues.push({ code: 'patrol_leg_not_connected', detail: `${patrol.id}: ${from}-${to}` });
      }
    }
    for (const id of patrol.waitAt ?? []) {
      if (!patrol.route.includes(id)) {
        issues.push({ code: 'patrol_wait_off_route', detail: `${patrol.id}: ${id}` });
      }
    }
  }

  const checkpointIds = new Set(data.checkpoints.map((node) => node.id));
  for (const mission of data.missions) {
    if (mission.checkpoints.length < 2) {
      issues.push({ code: 'mission_too_short', detail: mission.id });
    }
    for (const id of mission.checkpoints) {
      if (!checkpointIds.has(id)) {
        issues.push({ code: 'mission_unknown_checkpoint', detail: `${mission.id}: ${id}` });
      }
    }
    const last = mission.checkpoints[mission.checkpoints.length - 1];
    if (last === undefined || map.checkpoint(last).kind !== 'exit') {
      issues.push({ code: 'mission_does_not_end_at_exit', detail: mission.id });
    }
    for (const alternative of mission.alternatives ?? []) {
      if (alternative.index < 0 || alternative.index >= mission.checkpoints.length - 1) {
        issues.push({ code: 'mission_alternative_index', detail: mission.id });
      }
      for (const id of alternative.options) {
        if (!checkpointIds.has(id)) {
          issues.push({ code: 'mission_unknown_checkpoint', detail: `${mission.id}: ${id}` });
        }
      }
    }
  }

  return issues;
}

/**
 * A patrol leg has to be walkable at body width, not just as a hairline. Testing the
 * centre line plus both offset edges catches an edge that clips a door frame.
 */
function isCorridorClear(map: SchoolMap, a: Point, b: Point, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return true;

  const nx = (-dy / length) * radius;
  const ny = (dx / length) * radius;

  return (
    map.hasLineOfSight(a, b) &&
    map.hasLineOfSight({ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }) &&
    map.hasLineOfSight({ x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny })
  );
}
