/**
 * Mission generation (requirements 9, 10, 36, 37).
 *
 * A mission is an ordered list of checkpoints ending at the exit. The *pattern* is
 * authored in the map data, so a new objective route is a data change; the seed only
 * picks which pattern runs and swaps at most one stop for its declared alternative.
 *
 * That split is deliberate: a fully random objective order would make the stage a
 * memory-free scramble, and a fixed one would make it pure memorisation. One
 * substitution keeps "I know this route" useful while still asking the player to
 * look at the objective list.
 */
import type { MapCheckpoint, SchoolMapData } from '@/config/stages/teacher';
import type { Rng } from '@/utils/rng';

export interface Mission {
  readonly patternId: string;
  readonly label: string;
  /** In visiting order. The last entry is always the exit. */
  readonly checkpoints: readonly MapCheckpoint[];
}

/**
 * @param forcedPatternId dev-only override from `/dev` or `?t3mission=`, so one
 *        route can be iterated on. Unknown ids fall back to the seeded pick rather
 *        than throwing, because it is a debugging affordance, not an API.
 */
export function generateMission(data: SchoolMapData, rng: Rng, forcedPatternId?: string): Mission {
  if (data.missions.length === 0) {
    throw new Error(`Map "${data.id}" declares no mission patterns.`);
  }

  const forced = forcedPatternId
    ? data.missions.find((candidate) => candidate.id === forcedPatternId)
    : undefined;
  // The seeded draw happens either way, so forcing a pattern does not shift every
  // later draw (teacher start phases) relative to a normal run.
  const picked = rng.pick(data.missions);
  const pattern = forced ?? picked;
  const ids = [...pattern.checkpoints];

  for (const alternative of pattern.alternatives ?? []) {
    if (alternative.options.length === 0) continue;
    if (alternative.index < 0 || alternative.index >= ids.length) continue;
    ids[alternative.index] = rng.pick(alternative.options);
  }

  const byId = new Map(data.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const checkpoints = ids.map((id) => {
    const checkpoint = byId.get(id);
    if (!checkpoint) {
      throw new Error(`Mission "${pattern.id}" refers to unknown checkpoint "${id}".`);
    }
    return checkpoint;
  });

  return { patternId: pattern.id, label: pattern.label, checkpoints };
}

/**
 * Tracks progress through a mission.
 *
 * Kept separate from the scene so the "which objective is live" rule - one at a
 * time, in order, auto-collected on proximity - is testable on its own.
 */
export class MissionProgress {
  private index = 0;

  constructor(private readonly mission: Mission) {}

  get total(): number {
    return this.mission.checkpoints.length;
  }

  get completed(): number {
    return this.index;
  }

  get isComplete(): boolean {
    return this.index >= this.total;
  }

  /** The checkpoint the player must reach now, or null once the mission is done. */
  get current(): MapCheckpoint | null {
    return this.mission.checkpoints[this.index] ?? null;
  }

  /** True once every objective except the exit has been collected. */
  get isFinalLeg(): boolean {
    return !this.isComplete && this.index === this.total - 1;
  }

  /**
   * Collects the live checkpoint if the player is close enough.
   * Requirement 10: no confirm button - walking there is the interaction.
   */
  tryCollect(x: number, y: number, radiusPx: number): MapCheckpoint | null {
    const target = this.current;
    if (!target) return null;
    if (Math.hypot(target.x - x, target.y - y) > radiusPx) return null;
    this.index += 1;
    return target;
  }
}
