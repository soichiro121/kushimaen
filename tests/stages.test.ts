/**
 * Stage-level logic that runs without a renderer: the bread problem generator and the
 * shared clock helpers.
 *
 * Stage 3's stealth model has grown its own suite in `tests/teacher.test.ts`.
 *
 * All of it is deliberately Phaser-free so it can be tested like any other pure
 * module - which is what "the stage is a module, not a giant component" buys.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '@/config/rules';
import { BREAD_ITEMS, breadConfig } from '@/config/stages/bread';
import { generateBreadProblems } from '@/game/stages/bread/problemGenerator';
import { Countdown, GameClock } from '@/game/core/GameClock';
import { createRng } from '@/utils/rng';

describe('bread problem generation', () => {
  it('produces a question count inside the configured range', () => {
    for (let seed = 0; seed < 40; seed++) {
      const problems = generateBreadProblems(createRng(seed));
      expect(problems.length).toBeGreaterThanOrEqual(RULES.stages.bread.minQuestions);
      expect(problems.length).toBeLessThanOrEqual(RULES.stages.bread.maxQuestions);
    }
  });

  it('is deterministic for a given seed', () => {
    const describe = (seed: number) =>
      generateBreadProblems(createRng(seed)).map((p) => [
        p.target.id,
        p.choices.map((c) => c.id).join(','),
      ]);

    expect(describe(2024)).toEqual(describe(2024));
    expect(describe(1)).not.toEqual(describe(2));
  });

  it('always includes the target among the choices', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const problem of generateBreadProblems(createRng(seed))) {
        expect(problem.choices.map((c) => c.id)).toContain(problem.target.id);
      }
    }
  });

  it('never repeats a product on the shelf', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const problem of generateBreadProblems(createRng(seed))) {
        expect(new Set(problem.choices.map((c) => c.id)).size).toBe(problem.choices.length);
      }
    }
  });

  it('never asks for the same product twice in a row', () => {
    for (let seed = 0; seed < 30; seed++) {
      const problems = generateBreadProblems(createRng(seed));
      for (let i = 1; i < problems.length; i++) {
        expect(problems[i]!.target.id).not.toBe(problems[i - 1]!.target.id);
      }
    }
  });

  it('grows the shelf as the run progresses', () => {
    const problems = generateBreadProblems(createRng(7));
    const first = problems[0]!.choices.length;
    const last = problems[problems.length - 1]!.choices.length;

    expect(last).toBeGreaterThan(first);
    expect(first).toBeGreaterThanOrEqual(breadConfig.choices.start);
    expect(last).toBeLessThanOrEqual(Math.min(breadConfig.choices.end, BREAD_ITEMS.length));
  });

  /** The difficulty curve is "read the name properly", not "spot the odd one out". */
  it('puts more same-family look-alikes on the shelf later in the run', () => {
    let earlyDecoys = 0;
    let lateDecoys = 0;

    for (let seed = 0; seed < 40; seed++) {
      const problems = generateBreadProblems(createRng(seed));
      const countFamily = (index: number): number => {
        const problem = problems[index]!;
        return problem.choices.filter(
          (choice) => choice.family === problem.target.family && choice.id !== problem.target.id,
        ).length;
      };
      earlyDecoys += countFamily(0);
      lateDecoys += countFamily(problems.length - 1);
    }

    expect(lateDecoys).toBeGreaterThan(earlyDecoys);
  });

  it('lays the shelf out in a column count that fits a phone', () => {
    for (const problem of generateBreadProblems(createRng(5))) {
      expect(problem.columns).toBeGreaterThanOrEqual(2);
      expect(problem.columns).toBeLessThanOrEqual(3);
    }
  });

  it('refuses to run with a catalogue too small to fill a shelf', () => {
    expect(() => generateBreadProblems(createRng(1), BREAD_ITEMS.slice(0, 2))).toThrow();
  });

  it('has a catalogue big enough for the largest shelf', () => {
    expect(BREAD_ITEMS.length).toBeGreaterThanOrEqual(breadConfig.choices.end);
  });

  it('has unique product ids and asset ids', () => {
    expect(new Set(BREAD_ITEMS.map((i) => i.id)).size).toBe(BREAD_ITEMS.length);
    expect(new Set(BREAD_ITEMS.map((i) => i.assetId)).size).toBe(BREAD_ITEMS.length);
  });
});

describe('game clock', () => {
  it('does not advance before start or while paused', () => {
    const clock = new GameClock();
    clock.tick(100);
    expect(clock.elapsedMs).toBe(0);

    clock.start();
    clock.tick(50);
    clock.pause();
    clock.tick(1000);

    expect(clock.elapsedMs).toBe(50);

    clock.resume();
    clock.tick(25);
    expect(clock.elapsedMs).toBe(75);
  });

  /** Backgrounding the tab must not teleport a timer forward. */
  it('clamps a pathological frame delta', () => {
    const clock = new GameClock();
    clock.start();
    clock.tick(60_000);

    expect(clock.elapsedMs).toBeLessThanOrEqual(100);
  });

  it('reports remaining time in whole seconds, floored', () => {
    const clock = new GameClock();
    clock.start();
    for (let i = 0; i < 100; i++) clock.tick(50); // 5000ms

    expect(clock.remainingMs(10_000)).toBe(5000);
    expect(clock.remainingSec(10_000)).toBe(5);
    expect(clock.hasExpired(10_000)).toBe(false);
    expect(clock.hasExpired(4000)).toBe(true);
  });

  it('never reports negative remaining time', () => {
    const clock = new GameClock();
    clock.start();
    for (let i = 0; i < 200; i++) clock.tick(100);

    expect(clock.remainingMs(1000)).toBe(0);
    expect(clock.remainingSec(1000)).toBe(0);
  });
});

describe('countdown', () => {
  it('fires once per elapsed interval', () => {
    const countdown = new Countdown(100);

    expect(countdown.tick(50)).toBe(0);
    expect(countdown.tick(50)).toBe(1);
    expect(countdown.tick(250)).toBe(2);
  });

  it('never fires for a non-positive interval', () => {
    const countdown = new Countdown(0);
    expect(countdown.tick(1000)).toBe(0);
  });

  it('caps catch-up after an extreme hitch', () => {
    const countdown = new Countdown(10);
    expect(countdown.tick(100_000)).toBeLessThanOrEqual(11);
  });
});
