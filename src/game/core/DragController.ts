/**
 * Relative-drag input.
 *
 * The character follows how far the finger MOVED, not where it is. That matters on a
 * phone: with absolute positioning the player's own thumb covers the character they
 * are trying to steer. Relative dragging also lets the player re-grip anywhere on
 * screen without the character teleporting.
 *
 * Only the first active pointer is tracked, so a stray second touch (palm, other
 * thumb) cannot fight the first one.
 */
import Phaser from 'phaser';

export interface DragOptions {
  /** Finger travel is multiplied by this before being applied. */
  readonly sensitivity: number;
  readonly min: number;
  readonly max: number;
  readonly initialValue: number;
}

export class DragController {
  private readonly scene: Phaser.Scene;
  private readonly options: DragOptions;

  /** Where the player wants to be; the sprite eases toward it. */
  private target: number;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private enabled = true;

  constructor(scene: Phaser.Scene, options: DragOptions) {
    this.scene = scene;
    this.options = options;
    this.target = options.initialValue;

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  get value(): number {
    return this.target;
  }

  get isDragging(): boolean {
    return this.activePointerId !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.activePointerId = null;
  }

  setValue(value: number): void {
    this.target = Phaser.Math.Clamp(value, this.options.min, this.options.max);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled || this.activePointerId !== null) return;
    this.activePointerId = pointer.id;
    this.lastPointerX = pointer.x;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled || pointer.id !== this.activePointerId) return;
    const delta = pointer.x - this.lastPointerX;
    this.lastPointerX = pointer.x;
    this.setValue(this.target + delta * this.options.sensitivity);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.activePointerId) return;
    this.activePointerId = null;
  }

  /**
   * Frame-rate independent exponential smoothing toward the drag target.
   * `smoothing` is expressed per 16.67ms so the feel is identical at 30 and 60fps.
   */
  static ease(current: number, target: number, smoothing: number, deltaMs: number): number {
    const factor = 1 - Math.pow(1 - Phaser.Math.Clamp(smoothing, 0, 1), deltaMs / 16.667);
    return current + (target - current) * factor;
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
  }
}
