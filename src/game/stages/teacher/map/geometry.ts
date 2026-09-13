/**
 * Axis-aligned rectangle geometry for the stealth stage.
 *
 * Phaser-free and allocation-free on the hot paths, because these run a few hundred
 * times per frame (one sight test per teacher against every nearby wall).
 */
import type { Point, Rect } from '@/config/stages/teacher';

export function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

export function rectCenterX(rect: Rect): number {
  return rect.x + rect.width / 2;
}

export function rectCenterY(rect: Rect): number {
  return rect.y + rect.height / 2;
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rectRight(rect) && y >= rect.y && y <= rectBottom(rect);
}

/** True when a circle overlaps a rectangle (used for wall push-out). */
export function circleIntersectsRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const nearestX = clamp(x, rect.x, rectRight(rect));
  const nearestY = clamp(y, rect.y, rectBottom(rect));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Segment vs axis-aligned rectangle, by the slab method.
 *
 * Returns true when the segment (x0,y0)-(x1,y1) touches the rectangle at all. This
 * is the single primitive behind "you cannot be seen through a wall", so it is
 * written to be exact rather than clever.
 */
export function segmentIntersectsRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rect: Rect,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;

  let tMin = 0;
  let tMax = 1;

  // X slab
  if (dx === 0) {
    if (x0 < rect.x || x0 > rectRight(rect)) return false;
  } else {
    const inverse = 1 / dx;
    let t1 = (rect.x - x0) * inverse;
    let t2 = (rectRight(rect) - x0) * inverse;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  // Y slab
  if (dy === 0) {
    if (y0 < rect.y || y0 > rectBottom(rect)) return false;
  } else {
    const inverse = 1 / dy;
    let t1 = (rect.y - y0) * inverse;
    let t2 = (rectBottom(rect) - y0) * inverse;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return true;
}

/** Cheap rejection test before the slab method: do the bounding boxes overlap? */
export function segmentBoundsOverlapRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rect: Rect,
): boolean {
  if (Math.max(x0, x1) < rect.x) return false;
  if (Math.min(x0, x1) > rectRight(rect)) return false;
  if (Math.max(y0, y1) < rect.y) return false;
  if (Math.min(y0, y1) > rectBottom(rect)) return false;
  return true;
}

/** Shortest signed difference between two angles, in radians, within (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Rotates `from` toward `to` by at most `maxStep` radians. */
export function rotateToward(from: number, to: number, maxStep: number): number {
  const delta = angleDelta(from, to);
  if (Math.abs(delta) <= maxStep) return to;
  return from + Math.sign(delta) * maxStep;
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Distance along a segment, as a fraction in [0, 1], at which it first enters a
 * rectangle - or null when it never does.
 *
 * `segmentIntersectsRect` answers "is the view blocked"; this answers "where does the
 * light stop", which is what the vision cone needs in order to be clipped by walls.
 */
export function segmentHitT(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rect: Rect,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;

  let tMin = 0;
  let tMax = 1;

  if (dx === 0) {
    if (x0 < rect.x || x0 > rectRight(rect)) return null;
  } else {
    const inverse = 1 / dx;
    let t1 = (rect.x - x0) * inverse;
    let t2 = (rectRight(rect) - x0) * inverse;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (dy === 0) {
    if (y0 < rect.y || y0 > rectBottom(rect)) return null;
  } else {
    const inverse = 1 / dy;
    let t1 = (rect.y - y0) * inverse;
    let t2 = (rectBottom(rect) - y0) * inverse;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin;
}
