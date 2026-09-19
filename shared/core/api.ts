/**
 * The HTTP contract between the game and its API.
 *
 * Both sides import these: the client in `src/services/api/`, the serverless routes
 * in `api/`. One declaration, so a response shape cannot drift from what the client
 * expects to parse.
 */
import type { StageId } from './rules.js';

export interface HealthResponse {
  status: 'ok';
  configVersion: number;
  serverTime: string;
  /**
   * Deployment diagnostics. The client ignores these - it only looks at `status` -
   * but they turn "the game works and the leaderboard is empty" from a mystery into
   * one line of curl output.
   */
  checks?: {
    /** Whether DATABASE_URL is set. Not whether the database answers. */
    database: 'configured' | 'unconfigured';
  };
}

export interface CreateRunResponse {
  runId: string;
  /** Server-issued seed. The client must not invent its own in remote mode. */
  seed: number;
  configVersion: number;
  expiresAt: string;
  serverTime: string;
}

export interface StageSubmission {
  stageId: StageId;
  score: number;
  durationMs: number;
  metrics: Record<string, number>;
}

export interface CompleteRunRequest {
  nickname: string;
  stages: StageSubmission[];
  /** Client's own total. The server recomputes and only trusts its own value. */
  totalScore: number;
}

export interface CompleteRunResponse {
  accepted: boolean;
  /** Authoritative total computed by the server. */
  totalScore: number;
  /** Authoritative per-stage scores, keyed by stage id. */
  stageScores: Record<string, number>;
  /** Rank in the all-time board, when the entry was accepted. */
  rank: number | null;
  /** Present when the server adjusted or rejected the submission. */
  notice?: string;
}

export type LeaderboardPeriod = 'today' | 'all';

/**
 * Which score a board ranks: the run total, or one stage on its own.
 *
 * A stage board is not a slice of the total board. Someone who is unbeatable at the
 * bread RTA but hopeless at stealth never appears near the top of the combined
 * ranking, and a per-stage board is the only place that shows up.
 */
export type LeaderboardScope = 'total' | StageId;

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  /**
   * The score this board ranks: the run total on the combined board, that stage's
   * score on a stage board. Not named `totalScore`, because on a stage board it is
   * not a total and a name that lies is how the wrong number gets displayed.
   */
  score: number;
  createdAt: string;
  /** True for the row belonging to the run that was just submitted. */
  isMe?: boolean;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  /** Echoed back, so a client can tell which board it is looking at. */
  scope: LeaderboardScope;
  entries: LeaderboardEntry[];
  /** The caller's own placement, even when outside the returned page. */
  me: LeaderboardEntry | null;
  total: number;
}
