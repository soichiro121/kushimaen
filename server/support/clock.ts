/**
 * Time.
 *
 * Injected rather than read from `Date.now()` at the call site so the tests can
 * advance the clock and assert expiry, the daily board boundary and rate-limit
 * windows without sleeping.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test double: starts at a fixed instant and only moves when told to. */
export class FrozenClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceSeconds(seconds: number): void {
    this.advanceMs(seconds * 1000);
  }

  reset(to: Date): void {
    this.current = new Date(to.getTime());
  }
}
