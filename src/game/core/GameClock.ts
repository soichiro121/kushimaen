/**
 * Pause-safe game clock.
 *
 * Time is accumulated from the render loop's delta rather than from wall-clock
 * arithmetic, which means:
 *
 *   - backgrounding the tab cannot advance the timer (no rAF ticks, no deltas),
 *   - an explicit pause/resume is exact,
 *   - a long frame (GC spike, first-touch jank) cannot teleport the timer, because
 *     each delta is clamped.
 *
 * `setInterval` is deliberately not used anywhere for gameplay timing.
 */

/** Deltas above this are treated as a hitch and clamped (ms). */
const MAX_FRAME_DELTA_MS = 100;

export class GameClock {
  private elapsed = 0;
  private running = false;

  get elapsedMs(): number {
    return this.elapsed;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.elapsed = 0;
    this.running = true;
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Call once per frame with Phaser's delta. Returns the clamped delta applied. */
  tick(deltaMs: number): number {
    if (!this.running) return 0;
    const applied = Math.max(0, Math.min(deltaMs, MAX_FRAME_DELTA_MS));
    this.elapsed += applied;
    return applied;
  }

  remainingMs(limitMs: number): number {
    return Math.max(0, limitMs - this.elapsed);
  }

  /** Whole seconds remaining, the unit the score formula uses for time bonuses. */
  remainingSec(limitMs: number): number {
    return Math.floor(this.remainingMs(limitMs) / 1000);
  }

  hasExpired(limitMs: number): boolean {
    return this.elapsed >= limitMs;
  }
}

/**
 * A countdown/interval helper driven by the same clamped deltas, for spawn timers.
 * Using this instead of `scene.time.addEvent` keeps every timer consistent with the
 * pause model above.
 */
export class Countdown {
  private remaining: number;

  constructor(private intervalMs: number) {
    this.remaining = intervalMs;
  }

  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
  }

  reset(intervalMs?: number): void {
    if (intervalMs !== undefined) this.intervalMs = intervalMs;
    this.remaining = this.intervalMs;
  }

  /** Returns how many times the interval elapsed during this frame (usually 0 or 1). */
  tick(deltaMs: number): number {
    if (this.intervalMs <= 0) return 0;
    this.remaining -= deltaMs;
    let fired = 0;
    while (this.remaining <= 0) {
      this.remaining += this.intervalMs;
      fired += 1;
      if (fired > 10) break; // safety valve after an extreme hitch
    }
    return fired;
  }
}
