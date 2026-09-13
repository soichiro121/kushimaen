/**
 * Relative-drag steering for a top-down character (requirement 7).
 *
 *   touch start  ->  anchor
 *   finger moves ->  displacement from the anchor
 *   displacement ->  direction + 0..1 throttle
 *
 * The finger's ABSOLUTE position is never used. Two reasons, both of which matter on
 * a phone: the player's thumb would otherwise cover the character they are steering,
 * and they can re-grip anywhere on screen without the character jumping.
 *
 * Diagonals are normalised - the output vector's length is the throttle, so moving
 * north-east is exactly as fast as moving north (requirement 7).
 *
 * There is no visible joystick (requirement 8): the anchor is wherever the finger
 * landed, and it is dragged along once the finger runs past `maxOffsetPx`, so a long
 * swipe never feels like it hit the rim of an invisible stick.
 *
 * Pure logic, no Phaser: the scene feeds it pointer coordinates and the tests drive
 * it directly.
 */

export interface DragVectorOptions {
  /** Travel below this reads as "not moving" and kills thumb jitter. */
  readonly deadZonePx: number;
  /** Travel at which the throttle reaches 1. */
  readonly fullSpeedPx: number;
  /** Past this the anchor follows the finger, so the stick cannot saturate. */
  readonly maxOffsetPx: number;
}

export class DragVector {
  private active = false;
  private anchorX = 0;
  private anchorY = 0;
  private currentX = 0;
  private currentY = 0;
  /** Unit direction; (0, 0) when inside the dead zone. */
  private dirX = 0;
  private dirY = 0;
  private throttle = 0;

  constructor(private readonly options: DragVectorOptions) {}

  get isActive(): boolean {
    return this.active;
  }

  /** Unit-ish movement vector: length is the 0..1 throttle. */
  get x(): number {
    return this.dirX * this.throttle;
  }

  get y(): number {
    return this.dirY * this.throttle;
  }

  get magnitude(): number {
    return this.throttle;
  }

  /** Where the invisible stick is centred, for the optional on-screen hint. */
  get anchor(): { x: number; y: number } {
    return { x: this.anchorX, y: this.anchorY };
  }

  get pointer(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  start(x: number, y: number): void {
    this.active = true;
    this.anchorX = x;
    this.anchorY = y;
    this.currentX = x;
    this.currentY = y;
    this.dirX = 0;
    this.dirY = 0;
    this.throttle = 0;
  }

  move(x: number, y: number): void {
    if (!this.active) return;
    this.currentX = x;
    this.currentY = y;

    let dx = x - this.anchorX;
    let dy = y - this.anchorY;
    const length = Math.hypot(dx, dy);

    if (length > this.options.maxOffsetPx) {
      // Drag the anchor along behind the finger.
      const excess = length - this.options.maxOffsetPx;
      this.anchorX += (dx / length) * excess;
      this.anchorY += (dy / length) * excess;
      dx = x - this.anchorX;
      dy = y - this.anchorY;
    }

    const travel = Math.hypot(dx, dy);
    if (travel <= this.options.deadZonePx) {
      this.dirX = 0;
      this.dirY = 0;
      this.throttle = 0;
      return;
    }

    this.dirX = dx / travel;
    this.dirY = dy / travel;

    const span = Math.max(1, this.options.fullSpeedPx - this.options.deadZonePx);
    this.throttle = Math.min(1, (travel - this.options.deadZonePx) / span);
  }

  /** Finger lifted, or the touch was cancelled by the OS / a background switch. */
  end(): void {
    this.active = false;
    this.dirX = 0;
    this.dirY = 0;
    this.throttle = 0;
  }
}
