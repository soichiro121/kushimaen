/**
 * Detection build-up (requirement 20).
 *
 *   Detection 0% ──────────────▶ 100%
 *               visible, ~0.4s          caught
 *
 * One frame inside a cone must not be fatal: the player has to be able to dive round
 * a corner and watch the meter drain. Equally, the meter must not drain the instant
 * sight breaks, or a player could strobe in and out of a doorway for free.
 *
 * Pure and clock-driven (no wall clock, no Phaser), so pausing the game pauses the
 * meter for free and the balance simulator can drive it directly.
 */

export interface DetectionConfig {
  /** Time at the far edge of the cone to go from 0 to 1. */
  readonly fillMs: number;
  /** Multiplier applied at point-blank range (interpolated by `closeness`). */
  readonly closeRangeBoost: number;
  /** Time to drain from 1 back to 0 once sight is broken. */
  readonly decayMs: number;
  /** Grace before draining starts. */
  readonly decayDelayMs: number;
  /** Level at which the player counts as "spotted" for the perfect-stealth bonus. */
  readonly alertRatio: number;
}

export class DetectionMeter {
  private level = 0;
  private sinceSeenMs = Number.POSITIVE_INFINITY;
  /** Latched so one continuous exposure counts as one detection, not sixty. */
  private alertLatched = false;

  constructor(private readonly config: DetectionConfig) {}

  get value(): number {
    return this.level;
  }

  /** True while the meter is high enough to show the player a warning. */
  get isAlert(): boolean {
    return this.level >= this.config.alertRatio;
  }

  get isFull(): boolean {
    return this.level >= 1;
  }

  /**
   * Advances the meter.
   *
   * @param visible whether the observer can see the target this frame
   * @param closeness 0 at the edge of the cone, 1 at point-blank
   * @returns `alert` when this frame is the moment the meter first crossed the alert
   *          threshold for this exposure, so the caller can count it exactly once.
   */
  update(deltaMs: number, visible: boolean, closeness = 0): { alert: boolean; caught: boolean } {
    const wasAlert = this.alertLatched;

    if (visible) {
      this.sinceSeenMs = 0;
      const rate = 1 + (this.config.closeRangeBoost - 1) * clamp01(closeness);
      this.level = Math.min(1, this.level + (deltaMs / this.config.fillMs) * rate);
    } else {
      this.sinceSeenMs += deltaMs;
      if (this.sinceSeenMs >= this.config.decayDelayMs) {
        this.level = Math.max(0, this.level - deltaMs / this.config.decayMs);
      }
    }

    if (this.level >= this.config.alertRatio) {
      this.alertLatched = true;
    } else if (this.level <= 0) {
      // Only a full reset re-arms the latch, so flickering in and out of one cone
      // cannot inflate the detection count.
      this.alertLatched = false;
    }

    return { alert: !wasAlert && this.alertLatched, caught: this.level >= 1 };
  }

  /** Called after a catch or a respawn: the slate is clean. */
  reset(): void {
    this.level = 0;
    this.sinceSeenMs = Number.POSITIVE_INFINITY;
    this.alertLatched = false;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
