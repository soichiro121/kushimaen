/**
 * EVERYTHING THIS GAME SENDS TO ANALYTICS. There is nothing else.
 *
 * It is one closed union on purpose. Analytics is the easiest place in an app to
 * leak something by accident, and the players here are school students, so what
 * leaves the device should be reviewable in one screenful by someone who is not the
 * person who wrote it.
 *
 * THE RULES THESE TYPES ENFORCE
 *   - No free text. Every property is a number, a boolean, or a value from a fixed
 *     set. The nickname is the only text a player types, and it can never appear
 *     here because no event has a string field it would fit.
 *   - No identifiers. No run id, no session id, no device id. These events answer
 *     "how many" and "how far did they get", never "who".
 *   - At most two properties each. Vercel collects two per custom event on Pro, and
 *     silently drops the rest; a third would look fine locally and vanish in
 *     production.
 */
import type { StageId } from '@/config/rules';

/** Why a stage ended. Mirrors `StageEndReason` minus `abort`, which is not submitted. */
export type StageOutcome = 'cleared' | 'timeUp';

export type AnalyticsEvent =
  /**
   * Which mode the game resolved to. Fired once per session.
   *
   * This one exists because of a real outage: a broken `/api/health` silently put
   * every player into LOCAL MODE, the game looked completely normal, and nothing
   * anywhere said so. A rising `local` count is the signal that was missing.
   */
  | { name: 'backend_mode'; mode: 'remote' | 'local' }
  /** A run was opened - the denominator for everything below. */
  | { name: 'run_started'; stageCount: number }
  /** One mini-game finished. The drop-off between these is the funnel. */
  | { name: 'stage_finished'; stage: StageId; outcome: StageOutcome }
  /**
   * A full run reached the server (or the local board).
   *
   * Carries the total rather than the rank: the distribution of totals is what
   * tells you whether the balance is right, and a rank only makes sense relative
   * to a board that is changing underneath it.
   */
  | { name: 'run_submitted'; accepted: boolean; totalScore: number }
  /** Somebody actually looked at a board, and which one. */
  | { name: 'leaderboard_viewed'; scope: string; period: 'today' | 'all' };

/** The wire form: an event name and its properties, with the name removed. */
export function toPayload(event: AnalyticsEvent): {
  name: string;
  properties: Record<string, string | number | boolean>;
} {
  const { name, ...properties } = event;
  return { name, properties };
}
