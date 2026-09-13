/**
 * A patrolling teacher (requirements 12-16).
 *
 * Responsibilities are split into five small states rather than one clever brain:
 *
 *   PATROL      walking A -> B -> C -> D -> C -> B -> A along the authored route
 *   WAIT        standing at a waypoint, optionally sweeping their gaze
 *   TURN        stopping to look the other way (this is what catches good players)
 *   INVESTIGATE walking to where the player was last seen
 *   RETURN      walking back to the route and resuming
 *
 * PREDICTABILITY IS THE POINT (requirement 16). Nothing here rolls a die to decide
 * *where* to go - the route is fixed and learnable. Randomness only ever picks a
 * duration inside a configured min/max, or whether a scripted look-back happens, and
 * every draw comes from the run's seeded `Rng`. Two runs on the same seed are
 * identical; two runs on different seeds differ only in timing.
 *
 * Phaser-free on purpose: the scene renders this, the simulator scores it, the tests
 * assert it.
 */
import type { MapPatrol, Point, TeacherTypeConfig } from '@/config/stages/teacher';
import type { Rng } from '@/utils/rng';
import { degToRad, rotateToward } from '../map/geometry';
import type { SchoolMap } from '../map/SchoolMap';
import type { VisionCone } from './vision';

export type TeacherState = 'PATROL' | 'WAIT' | 'TURN' | 'INVESTIGATE' | 'RETURN';

export interface InvestigateConfig {
  readonly triggerRatio: number;
  readonly timeoutMs: number;
  readonly arriveRadiusPx: number;
  readonly speedScale: number;
}

/** How close to a waypoint counts as "arrived". Below one frame of travel. */
const ARRIVE_EPSILON_PX = 2;

export class TeacherAgent {
  readonly id: string;
  readonly type: TeacherTypeConfig;

  x: number;
  y: number;
  /** Radians. Where the eyes point, which is not always the travel direction. */
  facing: number;

  private state: TeacherState = 'PATROL';
  private readonly map: SchoolMap;
  private readonly patrol: MapPatrol;
  private readonly rng: Rng;
  private readonly investigateConfig: InvestigateConfig;

  /** Index into `patrol.route` of the node we are walking AWAY from. */
  private legIndex: number;
  /** Index of the node we are walking TOWARD. Never derived on the fly - advancing
   * flips `direction`, and a getter with a side effect is a bug waiting to happen. */
  private targetIndex: number;
  private direction: 1 | -1 = 1;

  private stateTimerMs = 0;
  private waitBaseFacing = 0;

  /** Node ids still to visit while off-route. Empty during PATROL. */
  private detour: string[] = [];
  private detourReturnNode: string;
  private investigateElapsedMs = 0;
  private lastKnown: Point | null = null;

  private movedThisFrame = false;

  constructor(
    map: SchoolMap,
    patrol: MapPatrol,
    type: TeacherTypeConfig,
    rng: Rng,
    investigateConfig: InvestigateConfig,
  ) {
    this.map = map;
    this.patrol = patrol;
    this.type = type;
    this.rng = rng;
    this.id = patrol.id;
    this.investigateConfig = investigateConfig;

    this.legIndex = clampIndex(patrol.startIndex ?? 0, patrol.route.length);
    this.targetIndex = this.stepIndex();
    this.detourReturnNode = this.routeNode(this.legIndex);

    const start = map.waypoint(this.routeNode(this.legIndex));
    this.x = start.x;
    this.y = start.y;

    const target = map.waypoint(this.routeNode(this.targetIndex));
    this.facing = Math.atan2(target.y - start.y, target.x - start.x);

    // Seeded start offset: the patrol pattern stays learnable, but a run never opens
    // at exactly the same moment in it (requirement 36).
    const [minPhase, maxPhase] = patrol.startPhaseRange ?? [0, 0];
    const phase = minPhase === maxPhase ? minPhase : rng.range(minPhase, maxPhase);
    this.x = start.x + (target.x - start.x) * phase;
    this.y = start.y + (target.y - start.y) * phase;
  }

  // -- read-only view -------------------------------------------------------

  get currentState(): TeacherState {
    return this.state;
  }

  get isMoving(): boolean {
    return this.movedThisFrame;
  }

  get position(): Point {
    return { x: this.x, y: this.y };
  }

  get cone(): VisionCone {
    return {
      facing: this.facing,
      distancePx: this.type.viewDistancePx,
      halfAngleRad: degToRad(this.type.viewAngleDeg) / 2,
    };
  }

  /** The point this teacher is heading for - drawn by the debug overlay. */
  get targetWaypointId(): string {
    if (this.detour.length > 0) return this.detour[0] as string;
    return this.routeNode(this.targetIndex);
  }

  // -- driving --------------------------------------------------------------

  update(deltaMs: number): void {
    this.movedThisFrame = false;

    switch (this.state) {
      case 'WAIT':
        this.updateWait(deltaMs);
        break;
      case 'TURN':
        this.updateTurn(deltaMs);
        break;
      case 'INVESTIGATE':
        this.updateInvestigate(deltaMs);
        break;
      case 'RETURN':
        this.updateReturn(deltaMs);
        break;
      case 'PATROL':
      default:
        this.updatePatrol(deltaMs);
        break;
    }
  }

  /**
   * Called by the scene when this teacher nearly saw the player. Diverts them to the
   * last known position - which is what makes "they walked past my hiding spot"
   * moments happen instead of the player being instantly forgotten.
   */
  investigate(point: Point): void {
    if (this.state === 'INVESTIGATE') {
      this.lastKnown = point;
      this.retargetInvestigation(point);
      return;
    }
    this.detourReturnNode = this.routeNode(this.legIndex);
    this.lastKnown = point;
    this.investigateElapsedMs = 0;
    this.state = 'INVESTIGATE';
    this.retargetInvestigation(point);
  }

  /** After the player is caught and respawns, everyone goes back to their beat. */
  resetToPatrol(): void {
    this.detour = [];
    this.lastKnown = null;
    this.state = 'PATROL';
    this.stateTimerMs = 0;
    // Walk on to the node ahead rather than standing still where they caught you.
    this.targetIndex = this.stepIndex();
  }

  // -- states ---------------------------------------------------------------

  private updatePatrol(deltaMs: number): void {
    const target = this.map.waypoint(this.routeNode(this.targetIndex));
    if (!this.stepToward(target, this.type.speedPxPerSec, deltaMs)) return;

    // Arrived: the target becomes the node we now walk away from, and the route
    // advances (reversing at either end).
    this.legIndex = this.targetIndex;
    this.targetIndex = this.stepIndex();
    const arrivedId = this.routeNode(this.legIndex);

    if ((this.patrol.waitAt ?? []).includes(arrivedId)) {
      this.beginWait();
      return;
    }
    if (this.rng.chance(this.type.turnProbability)) {
      this.beginTurn();
    }
  }

  private beginWait(): void {
    this.state = 'WAIT';
    this.stateTimerMs = this.rng.range(this.type.waitMs.minMs, this.type.waitMs.maxMs);
    this.waitBaseFacing = this.facing;
  }

  private updateWait(deltaMs: number): void {
    this.stateTimerMs -= deltaMs;

    if (this.type.scanArcDeg > 0) {
      // A steady sweep rather than a random jitter, so the player can time it.
      const arc = degToRad(this.type.scanArcDeg);
      const period = (arc * 2 * 1000) / Math.max(1, this.type.turnSpeedDegPerSec / 57.3);
      const phase = (this.stateTimerMs / Math.max(1, period)) * Math.PI * 2;
      this.facing = this.waitBaseFacing + Math.sin(phase) * arc;
    }

    if (this.stateTimerMs > 0) return;
    if (this.rng.chance(this.type.turnProbability)) {
      this.beginTurn();
      return;
    }
    this.state = 'PATROL';
  }

  private beginTurn(): void {
    this.state = 'TURN';
    // Look back the way they came. For a "looker" this is the dangerous moment: a
    // player who tailgated them down the corridor is suddenly in the cone.
    this.waitBaseFacing = this.facing + Math.PI;
    this.stateTimerMs = this.rng.range(420, 900);
  }

  private updateTurn(deltaMs: number): void {
    const step = degToRad(this.type.turnSpeedDegPerSec) * (deltaMs / 1000);
    this.facing = rotateToward(this.facing, this.waitBaseFacing, step);
    this.stateTimerMs -= deltaMs;
    if (this.stateTimerMs <= 0) this.state = 'PATROL';
  }

  private updateInvestigate(deltaMs: number): void {
    this.investigateElapsedMs += deltaMs;

    const speed = this.type.speedPxPerSec * this.investigateConfig.speedScale;
    const target = this.detourTarget() ?? this.lastKnown;

    if (target && this.stepToward(target, speed, deltaMs)) {
      if (this.detour.length > 0) this.detour.shift();
    }

    const arrived =
      this.lastKnown !== null &&
      this.detour.length === 0 &&
      Math.hypot(this.lastKnown.x - this.x, this.lastKnown.y - this.y) <
        this.investigateConfig.arriveRadiusPx;

    if (arrived || this.investigateElapsedMs >= this.investigateConfig.timeoutMs) {
      this.beginReturn();
    }
  }

  private beginReturn(): void {
    this.state = 'RETURN';
    this.lastKnown = null;
    const from = this.map.nearestWaypointId(this.x, this.y);
    this.detour = [...this.map.findPath(from, this.detourReturnNode)];
    if (this.detour.length === 0) this.detour = [this.detourReturnNode];
  }

  private updateReturn(deltaMs: number): void {
    const target = this.detourTarget();
    if (!target) {
      this.state = 'PATROL';
      return;
    }
    if (this.stepToward(target, this.type.speedPxPerSec, deltaMs)) {
      this.detour.shift();
      if (this.detour.length === 0) this.state = 'PATROL';
    }
  }

  // -- helpers --------------------------------------------------------------

  private retargetInvestigation(point: Point): void {
    const from = this.map.nearestWaypointId(this.x, this.y);
    const to = this.map.nearestWaypointId(point.x, point.y);
    this.detour = [...this.map.findPath(from, to)];
  }

  private detourTarget(): Point | null {
    const id = this.detour[0];
    return id === undefined ? null : this.map.waypoint(id);
  }

  /** Moves toward a point. Returns true on arrival. */
  private stepToward(target: Point, speedPxPerSec: number, deltaMs: number): boolean {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= ARRIVE_EPSILON_PX) return true;

    const step = (speedPxPerSec * deltaMs) / 1000;
    // Eyes lead the body: turning is instant along a corridor but the facing is
    // eased so a corner does not snap the cone through a wall in one frame.
    const heading = Math.atan2(dy, dx);
    this.facing = rotateToward(
      this.facing,
      heading,
      degToRad(this.type.turnSpeedDegPerSec) * (deltaMs / 1000),
    );

    if (step >= distance) {
      this.x = target.x;
      this.y = target.y;
      this.movedThisFrame = true;
      return true;
    }

    this.x += (dx / distance) * step;
    this.y += (dy / distance) * step;
    this.movedThisFrame = true;
    return false;
  }

  private routeNode(index: number): string {
    return this.patrol.route[index] as string;
  }

  /**
   * Ping-pong: A-B-C-D-C-B-A rather than teleporting from the end back to the start.
   * Flips `direction` as a deliberate side effect, which is why only the arrival
   * handler and the constructor call it.
   */
  private stepIndex(): number {
    const last = this.patrol.route.length - 1;
    if (last <= 0) return 0;

    let next = this.legIndex + this.direction;
    if (next > last) {
      this.direction = -1;
      next = last - 1;
    } else if (next < 0) {
      this.direction = 1;
      next = 1;
    }
    return next;
  }
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(Math.floor(index), length - 1));
}
