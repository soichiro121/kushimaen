/**
 * Wire types for the PHP API.
 *
 * These mirror `backend/src/Controller/*` exactly. Keep both sides in step - the
 * backend's integration tests assert this shape.
 */
import type { StageId } from '@/config/rules';

export interface HealthResponse {
  status: 'ok';
  configVersion: number;
  serverTime: string;
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

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  totalScore: number;
  createdAt: string;
  /** True for the row belonging to the run that was just submitted. */
  isMe?: boolean;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  /** The caller's own placement, even when outside the returned page. */
  me: LeaderboardEntry | null;
  total: number;
}
