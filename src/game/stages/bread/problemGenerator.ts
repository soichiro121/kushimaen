/**
 * Order (question) generation for STAGE 2.
 *
 * Pure and seeded: given the same run seed the same shelves appear, which makes the
 * stage replayable, verifiable and unit-testable. Lives outside the Phaser scene
 * precisely so it can be tested without a renderer.
 */
import { BREAD_ITEMS, breadConfig, type BreadItem } from '@/config/stages/bread';
import type { Rng } from '@/utils/rng';

export interface BreadProblem {
  readonly index: number;
  readonly target: BreadItem;
  /** Everything on the shelf, already shuffled. Always contains `target`. */
  readonly choices: readonly BreadItem[];
  readonly columns: number;
}

function lerpInt(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

function columnsFor(choiceCount: number): number {
  for (const rule of breadConfig.layout.columns) {
    if (choiceCount <= rule.upTo) return rule.columns;
  }
  return 3;
}

/**
 * Builds the full set of orders for one play-through.
 *
 * Difficulty rises in two ways, both interpolated from the first order to the last:
 *   - more products on the shelf,
 *   - more products from the *same family* as the target (メロンパン next to
 *     ホイップメロンパン), so the name has to be read properly.
 */
export function generateBreadProblems(
  rng: Rng,
  catalogue: readonly BreadItem[] = BREAD_ITEMS,
): BreadProblem[] {
  if (catalogue.length < breadConfig.choices.start) {
    throw new Error(
      `The bread catalogue needs at least ${breadConfig.choices.start} items, got ${catalogue.length}.`,
    );
  }

  const questionCount = rng.int(breadConfig.questions.min, breadConfig.questions.max);
  const problems: BreadProblem[] = [];
  let previousTargetId: string | null = null;

  for (let index = 0; index < questionCount; index++) {
    const t = questionCount <= 1 ? 1 : index / (questionCount - 1);

    const choiceCount = Math.min(
      catalogue.length,
      lerpInt(breadConfig.choices.start, breadConfig.choices.end, t),
    );

    // Harder products become likelier targets as the run progresses.
    const candidates = catalogue.filter((item) => item.id !== previousTargetId);
    const target = rng.weighted(candidates, (item) => 1 + (item.difficulty - 1) * t * 2);
    previousTargetId = target.id;

    const wantedDecoys = Math.min(
      lerpInt(breadConfig.similarDecoys.start, breadConfig.similarDecoys.end, t),
      choiceCount - 1,
    );

    const sameFamily = catalogue.filter(
      (item) => item.family === target.family && item.id !== target.id,
    );
    const decoys = rng.sample(sameFamily, wantedDecoys);

    const chosen = new Set([target.id, ...decoys.map((item) => item.id)]);
    const filler = rng
      .shuffle(catalogue.filter((item) => !chosen.has(item.id)))
      .slice(0, Math.max(0, choiceCount - chosen.size));

    const choices = rng.shuffle([target, ...decoys, ...filler]);

    problems.push({ index, target, choices, columns: columnsFor(choices.length) });
  }

  return problems;
}
