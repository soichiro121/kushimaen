/**
 * Stage registry.
 *
 * ADDING A FOURTH MINI-GAME
 *   1. Create `src/game/stages/<id>/` with a module that satisfies `StageModule`.
 *   2. Add its id to `stageOrder` and a `stages.<id>` block in
 *      `shared/game-rules/v2.json` (plus the matching PHP score branch).
 *   3. Add one line to `STAGE_MODULES` below.
 *
 * Nothing else in the app - the flow machine, result screens, submission pipeline,
 * leaderboard, dev tools - needs to change.
 */
import { RULES, type StageId } from '@/config/rules';
import { GAME_CONFIG } from '@/config/game';
import type { StageModule } from '@/game/core/stageTypes';
import { breadStage } from './bread';
import { lateStage } from './late';
import { teacherStage } from './teacher';

const STAGE_MODULES: readonly StageModule[] = [lateStage, breadStage, teacherStage];

const BY_ID = new Map<StageId, StageModule>(STAGE_MODULES.map((stage) => [stage.id, stage]));

export function getStageModule(id: StageId): StageModule {
  const stage = BY_ID.get(id);
  if (!stage) throw new Error(`Stage "${id}" is not registered (src/game/stages/index.ts).`);
  return stage;
}

export function findStageModule(id: string): StageModule | undefined {
  return BY_ID.get(id as StageId);
}

/** Every registered stage, including disabled ones (used by the dev tools). */
export function allStageModules(): readonly StageModule[] {
  return STAGE_MODULES;
}

/**
 * The stages an actual run plays, in order: declared order from the rule set,
 * filtered by the per-stage feature flag and the runtime config override.
 *
 * Cached because both inputs (the module's `enabled` flag and the build-time
 * feature flags) are constant for the life of the process. Returning a fresh array
 * each call would give React a new identity on every store read, which would make
 * memoised effects - notably the background asset preload - re-run forever.
 */
let playableCache: readonly StageModule[] | null = null;

export function playableStages(): readonly StageModule[] {
  return (playableCache ??= RULES.stageOrder
    .map((id) => BY_ID.get(id))
    .filter((stage): stage is StageModule => Boolean(stage))
    .filter((stage) => stage.enabled && GAME_CONFIG.stageEnabled(stage.id)));
}

export function playableStageIds(): readonly StageId[] {
  return playableStages().map((stage) => stage.id);
}
