/**
 * Development-only stage overrides (requirement 51).
 *
 * Lets `/dev` and the query string force a particular map, mission pattern, seed,
 * teacher count or vision-cone setting, so stage 3 can be iterated on without
 * replaying the whole run to reach it.
 *
 * SAFETY: every read goes through `GAME_CONFIG.devToolsAvailable`, which is false in
 * a normal production build. A player on the live site cannot reach any of this with
 * a query string, so it can never be used to farm an easy seed.
 */
import { GAME_CONFIG } from '@/config/game';

export interface TeacherStageOverrides {
  /** Map id from `src/config/stages/teacher/maps/`. */
  mapId?: string;
  /** Mission pattern id (`A`, `B`, `C`, ...). */
  missionId?: string;
  /** Forces the stage seed, so a specific patrol timing can be replayed. */
  seed?: number;
  /** Caps how many of the map's teachers are on duty. */
  teacherCount?: number;
  /** Overrides `teacherConfig.vision.showVisionCone`. */
  showVisionCone?: boolean;
}

const overrides: TeacherStageOverrides = {};

function parseQueryString(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);

  const map = params.get('t3map');
  if (map) overrides.mapId = map;

  const mission = params.get('t3mission');
  if (mission) overrides.missionId = mission;

  // `Number(null)` is 0, so an ABSENT parameter must be rejected before parsing -
  // otherwise simply opening /dev silently ran the stage with zero teachers.
  const seed = params.get('t3seed');
  if (seed !== null && Number.isFinite(Number(seed)) && Number(seed) > 0) {
    overrides.seed = Number(seed) >>> 0;
  }

  const count = params.get('t3teachers');
  if (count !== null && Number.isFinite(Number(count)) && Number(count) >= 0) {
    overrides.teacherCount = Math.floor(Number(count));
  }

  const cone = params.get('t3cone');
  if (cone !== null) overrides.showVisionCone = cone === '1' || cone === 'true';
}

if (GAME_CONFIG.devToolsAvailable) parseQueryString();

/** Always empty in production. */
export function teacherOverrides(): Readonly<TeacherStageOverrides> {
  return GAME_CONFIG.devToolsAvailable ? overrides : {};
}

export function setTeacherOverrides(next: TeacherStageOverrides): void {
  if (!GAME_CONFIG.devToolsAvailable) return;
  Object.assign(overrides, next);
}

export function clearTeacherOverrides(): void {
  for (const key of Object.keys(overrides)) {
    delete overrides[key as keyof TeacherStageOverrides];
  }
}
