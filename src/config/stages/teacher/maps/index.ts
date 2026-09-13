/**
 * School map registry.
 *
 * SWAPPING IN THE REAL SCHOOL
 *   1. Add `realSchool.ts` next to this file, exporting a `SchoolMapData`.
 *   2. Add one line to `SCHOOL_MAPS` below.
 *   3. Point `DEFAULT_MAP_ID` at it (or pick it from `/dev` while working on it).
 *
 * That is the whole procedure. `TeacherScene` never names a map.
 */
import type { SchoolMapData } from '../mapTypes';
import { komabaPlaceholderMap } from './komabaPlaceholder';

export const SCHOOL_MAPS = {
  komabaPlaceholder: komabaPlaceholderMap,
} as const satisfies Record<string, SchoolMapData>;

export type SchoolMapId = keyof typeof SCHOOL_MAPS;

export const DEFAULT_MAP_ID: SchoolMapId = 'komabaPlaceholder';

export function getSchoolMap(id: string): SchoolMapData {
  const map = (SCHOOL_MAPS as Record<string, SchoolMapData>)[id];
  if (!map) {
    throw new Error(
      `Unknown school map "${id}". Register it in src/config/stages/teacher/maps/index.ts.`,
    );
  }
  return map;
}

export function allSchoolMaps(): readonly SchoolMapData[] {
  return Object.values(SCHOOL_MAPS);
}
