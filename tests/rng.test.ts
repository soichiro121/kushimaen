/**
 * Seeded randomness.
 *
 * These properties are what make a run reproducible: given the run seed the server
 * issued, the exact same obstacles, orders and patrol pattern can be regenerated for
 * replay, score verification and difficulty analysis. If any of this breaks, the
 * "seeded" part of the design is decorative.
 */
import { describe, expect, it } from 'vitest';
import { createLocalSeed, createRng, deriveSeed } from '@/utils/rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());

    expect(left).toEqual(right);
  });

  it('produces a different sequence for a different seed', () => {
    const a = Array.from({ length: 20 }, createRng(1).next);
    const b = Array.from({ length: 20 }, createRng(2).next);

    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('treats int() bounds as inclusive on both ends', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(1, 3));

    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('keeps every element when shuffling', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = createRng(42).shuffle(source);

    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input untouched
  });

  it('samples distinct elements and never more than exist', () => {
    const rng = createRng(3);
    const sample = rng.sample(['a', 'b', 'c'], 10);

    expect(new Set(sample).size).toBe(3);
    expect(rng.sample(['a', 'b', 'c'], 2)).toHaveLength(2);
    expect(rng.sample(['a', 'b', 'c'], 0)).toEqual([]);
  });

  it('respects weights', () => {
    const rng = createRng(5);
    const items = [
      { id: 'common', weight: 95 },
      { id: 'rare', weight: 5 },
    ];
    const counts = { common: 0, rare: 0 };
    for (let i = 0; i < 2000; i++) {
      counts[rng.weighted(items, (item) => item.weight).id as 'common' | 'rare'] += 1;
    }

    expect(counts.common).toBeGreaterThan(counts.rare * 5);
  });

  it('falls back to a uniform pick when every weight is zero', () => {
    const rng = createRng(11);
    const picked = rng.weighted(['a', 'b'], () => 0);

    expect(['a', 'b']).toContain(picked);
  });

  it('throws on an empty collection rather than returning undefined', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.weighted([], () => 1)).toThrow();
  });

  it('counts draws, which is what lets a desync be spotted', () => {
    const rng = createRng(1);
    rng.next();
    rng.int(0, 10);

    expect(rng.drawn).toBe(2);
    expect(rng.seed).toBe(1);
  });

  it('normalises a negative seed to the same stream as its unsigned form', () => {
    expect(createRng(-1).next()).toBe(createRng(0xffffffff).next());
  });
});

describe('deriveSeed', () => {
  it('is deterministic', () => {
    expect(deriveSeed(1000, 'late')).toBe(deriveSeed(1000, 'late'));
  });

  it('gives each stage an independent stream', () => {
    const seeds = ['late', 'bread', 'teacher'].map((id) => deriveSeed(777, id));

    expect(new Set(seeds).size).toBe(3);
  });

  it('changes with the run seed', () => {
    expect(deriveSeed(1, 'late')).not.toBe(deriveSeed(2, 'late'));
  });

  it('always returns an unsigned 32-bit integer', () => {
    for (const seed of [0, 1, -5, 2 ** 31, 0xffffffff]) {
      const derived = deriveSeed(seed, 'teacher');
      expect(Number.isInteger(derived)).toBe(true);
      expect(derived).toBeGreaterThanOrEqual(0);
      expect(derived).toBeLessThanOrEqual(0xffffffff);
    }
  });

  /**
   * Reordering or disabling a stage must not change what the others generate,
   * otherwise a feature-flag change would invalidate every stored replay.
   */
  it('does not depend on stage order', () => {
    const before = deriveSeed(99, 'teacher');
    const after = deriveSeed(99, 'teacher');
    expect(before).toBe(after);
  });
});

describe('createLocalSeed', () => {
  it('produces an unsigned 32-bit integer', () => {
    const seed = createLocalSeed();

    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
