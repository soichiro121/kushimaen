/**
 * Central game configuration.
 *
 * Every operational lever lives here rather than being scattered through the code:
 * title, per-stage feature flags, difficulty multiplier, maintenance mode, dev-tool
 * visibility and the API base URL.
 *
 * Sources, in increasing priority:
 *   1. `shared/game-rules/vN.json`  (balance - shared with the backend)
 *   2. build-time env (`.env`, `VITE_*`)
 *   3. runtime query string (debug only, and only where it is safe)
 */
import { RULES, type StageId } from './rules';

function envFlag(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function queryParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

const env = import.meta.env;

const DISABLED_STAGES = new Set(
  (env.VITE_DISABLED_STAGES ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

/**
 * Debug tooling is available when the bundle is a dev build, or when a production
 * build explicitly opts in via `VITE_ENABLE_DEV_TOOLS=1` (useful for a staging URL).
 * Ordinary players on production can never turn it on with a query string alone.
 */
const DEV_TOOLS_AVAILABLE = import.meta.env.DEV || envFlag(env.VITE_ENABLE_DEV_TOOLS);

export interface GameConfig {
  readonly title: string;
  readonly subtitle: string;
  readonly configVersion: number;
  readonly apiBaseUrl: string;
  readonly maintenance: boolean;
  readonly difficultyScale: number;
  /** True when /dev routes and the debug overlay may exist at all. */
  readonly devToolsAvailable: boolean;
  /** True when the debug overlay is actually switched on (`?debug=1`). */
  readonly debugOverlay: boolean;
  stageEnabled(id: StageId): boolean;
}

function readDebugOverlay(): boolean {
  if (!DEV_TOOLS_AVAILABLE) return false;
  const debug = queryParams().get('debug');
  return debug === '1' || debug === 'true';
}

export const GAME_CONFIG: GameConfig = {
  title: env.VITE_TITLE || RULES.title,
  subtitle: RULES.subtitle,
  configVersion: RULES.configVersion,
  // Empty base = same-origin `/api`, which is what production uses (no CORS).
  apiBaseUrl: (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, ''),
  maintenance: envFlag(env.VITE_MAINTENANCE),
  difficultyScale: envNumber(env.VITE_DIFFICULTY_SCALE, 1),
  devToolsAvailable: DEV_TOOLS_AVAILABLE,
  debugOverlay: readDebugOverlay(),
  stageEnabled(id: StageId): boolean {
    return !DISABLED_STAGES.has(id);
  },
};
