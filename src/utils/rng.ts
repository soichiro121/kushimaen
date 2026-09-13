/**
 * Seeded pseudo-random number generator.
 *
 * RULE: gameplay code must never call `Math.random()`. Every random decision goes
 * through an `Rng` derived from the run seed, so a run can be replayed, a reported
 * score can be re-simulated, and difficulty can be analysed offline.
 *
 * Algorithm: mulberry32 - tiny, fast, and good enough for gameplay (it is not and
 * must not be used as a cryptographic RNG).
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p` (0..1). */
  chance(p: number): boolean;
  /** Uniformly pick an element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Pick `count` distinct elements (or all of them when count >= length). */
  sample<T>(items: readonly T[], count: number): T[];
  /** Weighted pick; weights must be non-negative and not all zero. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  /** The seed this generator was created with (for debug overlays / replay). */
  readonly seed: number;
  /** How many numbers have been drawn - handy for desync debugging. */
  readonly drawn: number;
}

export function createRng(seed: number): Rng {
  // Normalise to an unsigned 32-bit integer so behaviour is identical across
  // platforms regardless of how the seed was produced.
  let state = seed >>> 0;
  let drawn = 0;

  const next = (): number => {
    drawn += 1;
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Rng.pick called with an empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as T;
        copy[i] = copy[j] as T;
        copy[j] = a;
      }
      return copy;
    },
    sample<T>(items: readonly T[], count: number): T[] {
      return rng.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
    },
    weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
      if (items.length === 0) throw new Error('Rng.weighted called with an empty array');
      let total = 0;
      for (const item of items) total += Math.max(0, weightOf(item));
      if (total <= 0) return rng.pick(items);
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, weightOf(item));
        if (roll <= 0) return item;
      }
      return items[items.length - 1] as T;
    },
    get seed() {
      return seed >>> 0;
    },
    get drawn() {
      return drawn;
    },
  };

  return rng;
}

/**
 * Derives a stable child seed from a run seed and a label.
 *
 * Each stage gets its own independent stream, so re-ordering or disabling a stage
 * does not change what the other stages generate. This keeps replays valid across
 * feature-flag changes.
 */
export function deriveSeed(runSeed: number, label: string): number {
  // FNV-1a over the label, mixed with the run seed.
  let hash = 0x811c9dc5 ^ (runSeed >>> 0);
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Generates a seed for LOCAL MODE only. In production the seed is issued by the
 * server together with the run id, so the client cannot fish for an easy seed.
 */
export function createLocalSeed(): number {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return (buffer[0] ?? 1) >>> 0;
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
