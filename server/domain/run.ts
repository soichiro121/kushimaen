/**
 * A run: one play-through, opened by the server before the player starts.
 *
 * The run is what ties a submitted score to something the server issued. Without it a
 * client could POST a score for a game it never started.
 */

export const RUN_STATUS = {
  open: 'open',
  completed: 'completed',
  rejected: 'rejected',
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export interface Run {
  readonly id: string;
  readonly seed: number;
  readonly configVersion: number;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly completedAt: Date | null;
  readonly status: RunStatus;
}

export function isOpen(run: Run): boolean {
  return run.status === RUN_STATUS.open;
}

export function isExpiredAt(run: Run, now: Date): boolean {
  return now.getTime() > run.expiresAt.getTime();
}

/** UUID v4, the shape `newRunId()` produces. Checked before touching the database. */
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID_PATTERN.test(value);
}
