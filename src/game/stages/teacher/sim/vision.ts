/**
 * Field-of-view test (requirement 17).
 *
 *        👨‍🏫
 *       ╱ │ ╲      distance  -> is the target close enough?
 *      ╱  │  ╲     angle     -> is it inside the cone?
 *         ▼        occlusion -> is there a wall in the way?
 *
 * The three checks are ordered cheapest-first: the distance test rejects almost
 * everything, so the wall scan runs only when the player is genuinely in the cone.
 */
import type { Point } from '@/config/stages/teacher';
import { angleDelta } from '../map/geometry';
import type { SchoolMap } from '../map/SchoolMap';

export interface VisionCone {
  /** Where the observer is looking, in radians. */
  readonly facing: number;
  readonly distancePx: number;
  /** Half the cone's opening, in radians. */
  readonly halfAngleRad: number;
}

export interface VisionResult {
  readonly visible: boolean;
  /** Distance between observer and target, always filled in. */
  readonly distance: number;
  /** 0 at the far edge of the cone, 1 at point-blank. Only meaningful when visible. */
  readonly closeness: number;
}

const NOT_VISIBLE = (distance: number): VisionResult => ({
  visible: false,
  distance,
  closeness: 0,
});

/**
 * Can an observer at `from`, looking along `cone.facing`, see `target`?
 *
 * `map` supplies the walls. A target standing behind a corner is never visible,
 * however close it is - that is the whole point of the stage.
 */
export function canSee(from: Point, target: Point, cone: VisionCone, map: SchoolMap): VisionResult {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (distance > cone.distancePx) return NOT_VISIBLE(distance);

  // Standing on top of someone counts as seeing them; the angle is meaningless there.
  if (distance > 1) {
    const toTarget = Math.atan2(dy, dx);
    if (Math.abs(angleDelta(cone.facing, toTarget)) > cone.halfAngleRad) {
      return NOT_VISIBLE(distance);
    }
  }

  if (!map.hasLineOfSight(from, target)) return NOT_VISIBLE(distance);

  return {
    visible: true,
    distance,
    closeness: 1 - distance / Math.max(1, cone.distancePx),
  };
}
