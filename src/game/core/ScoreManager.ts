/**
 * ScoreManager - the single owner of a stage's score.
 *
 *     gameplay event  ->  ScoreManager  ->  metrics  ->  score formula  ->  UI event
 *
 * Scoring rules live in `scoring.ts` (shared with the API). This class only accumulates
 * metrics and derives the score from them, which guarantees three things:
 *
 *   - the number on screen is always exactly `computeStageScore(stageId, metrics)`,
 *   - the server can recompute the same value from the submitted metrics,
 *   - no display code ever performs score arithmetic.
 */
import { computeStageScore, computeStageScoreRaw, type StageMetrics } from './scoring';
import type { StageId } from '@/config/rules';

export type ScoreEventKind =
  | 'nearMiss'
  | 'collision'
  | 'goal'
  | 'correct'
  | 'mistake'
  | 'checkpoint'
  | 'danger'
  | 'caught'
  | 'clear';

export interface ScoreEvent {
  readonly kind: ScoreEventKind;
  /** Score change caused by this event. Always derived, never hand-written. */
  readonly delta: number;
  /** Total score after the event. */
  readonly total: number;
  /** Combo level after the event (0 when the event broke the combo). */
  readonly combo: number;
  /** Optional label for the floating popup, e.g. `NEAR MISS`. */
  readonly label?: string;
  /** Optional world position for the popup. */
  readonly x?: number;
  readonly y?: number;
}

export type ScoreEventListener = (event: ScoreEvent) => void;

export interface AwardOptions {
  readonly label?: string;
  readonly x?: number;
  readonly y?: number;
  /** `extend` increments the combo, `break` resets it, `keep` leaves it alone. */
  readonly combo?: 'extend' | 'break' | 'keep';
}

export class ScoreManager {
  private readonly stageId: StageId;
  private readonly counters = new Map<string, number>();
  private readonly listeners = new Set<ScoreEventListener>();
  private comboLevel = 0;
  private comboMax = 0;

  constructor(stageId: StageId) {
    this.stageId = stageId;
  }

  get score(): number {
    return computeStageScore(this.stageId, this.metrics);
  }

  /**
   * Score without the zero clamp. Used only to measure event deltas: while the
   * clamped score sits at zero, a penalty would otherwise report a delta of 0 and
   * the popup would read "+0" instead of "-500".
   */
  private get rawScore(): number {
    return computeStageScoreRaw(this.stageId, this.metrics);
  }

  get combo(): number {
    return this.comboLevel;
  }

  get maxCombo(): number {
    return this.comboMax;
  }

  get metrics(): StageMetrics {
    return Object.fromEntries(this.counters);
  }

  getMetric(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  /** Raw metric write that does not emit a score event (setup / final bookkeeping). */
  setMetric(key: string, value: number): void {
    this.counters.set(key, value);
  }

  addMetric(key: string, delta = 1): void {
    this.counters.set(key, this.getMetric(key) + delta);
  }

  onEvent(listener: ScoreEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Applies a metric mutation and publishes the resulting score delta.
   *
   * The delta is measured (score after minus score before) rather than passed in, so
   * the popup can never disagree with the scoreboard.
   */
  award(
    kind: ScoreEventKind,
    mutate: (score: ScoreMutator) => void,
    options: AwardOptions = {},
  ): ScoreEvent {
    const before = this.rawScore;

    switch (options.combo) {
      case 'extend':
        this.comboLevel += 1;
        this.comboMax = Math.max(this.comboMax, this.comboLevel);
        break;
      case 'break':
        this.comboLevel = 0;
        break;
      default:
        break;
    }

    mutate({
      add: (key, delta = 1) => this.addMetric(key, delta),
      set: (key, value) => this.setMetric(key, value),
      combo: this.comboLevel,
    });

    this.setMetric('maxCombo', this.comboMax);

    const total = this.score;
    const event: ScoreEvent = {
      kind,
      delta: this.rawScore - before,
      total,
      combo: this.comboLevel,
      label: options.label,
      x: options.x,
      y: options.y,
    };
    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Drops all listeners. Call from the scene's shutdown handler. */
  destroy(): void {
    this.listeners.clear();
  }
}

export interface ScoreMutator {
  add(key: string, delta?: number): void;
  set(key: string, value: number): void;
  /** Combo level after this award's combo handling - used to compute combo units. */
  readonly combo: number;
}
