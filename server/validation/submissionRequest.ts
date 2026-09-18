/**
 * Request-shape validation for `POST /api/runs/{runId}/complete`.
 *
 * This is the layer that decides whether the JSON is even a submission. It runs
 * BEFORE any scoring, so `validateSubmission` downstream can assume a flat map of
 * finite numbers and concern itself only with whether those numbers are plausible.
 *
 * Everything here is a hard bound rather than a judgement call: an unbounded metric
 * map is a memory-exhaustion vector, and a 10MB nickname is not a typo.
 */
import { ApiError } from '../http/apiError.js';
import type { StageSubmission } from '../../shared/core/api.js';
import type { StageId } from '../../shared/core/rules.js';

const MAX_STAGES = 8;
const MAX_METRICS_PER_STAGE = 32;
const MAX_METRIC_KEY_LENGTH = 40;
/** Bytes, not characters. The character-level rule is applied after sanitising. */
const MAX_NICKNAME_BYTES = 256;

const STAGE_ID = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const METRIC_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export interface ParsedSubmission {
  readonly nickname: string;
  readonly stages: StageSubmission[];
  /** The client's own total. Parsed so it can be logged, never so it can be trusted. */
  readonly totalScore: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseSubmission(body: unknown): ParsedSubmission {
  if (!isRecord(body)) {
    throw ApiError.unprocessable('invalid_body', 'リクエストの形式が不正です');
  }

  const { nickname } = body;
  if (typeof nickname !== 'string') {
    throw ApiError.unprocessable('invalid_nickname', 'ニックネームを確認してください');
  }
  if (new TextEncoder().encode(nickname).length > MAX_NICKNAME_BYTES) {
    throw ApiError.unprocessable('invalid_nickname', 'ニックネームが長すぎます');
  }

  const stagesRaw = body.stages;
  if (!Array.isArray(stagesRaw)) {
    throw ApiError.unprocessable('invalid_stages', 'ステージ結果の形式が不正です');
  }
  if (stagesRaw.length > MAX_STAGES) {
    throw ApiError.unprocessable('too_many_stages', 'ステージ結果が多すぎます');
  }

  const stages = stagesRaw.map((stage, index) => parseStage(stage, index));

  const totalScore = body.totalScore ?? 0;
  if (!finiteNumber(totalScore)) {
    throw ApiError.unprocessable('invalid_total', 'スコアの形式が不正です');
  }

  return { nickname, stages, totalScore: Math.trunc(totalScore) };
}

function parseStage(raw: unknown, index: number): StageSubmission {
  if (!isRecord(raw)) {
    throw ApiError.unprocessable('invalid_stage', `stages[${index}] の形式が不正です`);
  }

  const { stageId } = raw;
  if (typeof stageId !== 'string' || !STAGE_ID.test(stageId)) {
    throw ApiError.unprocessable('invalid_stage_id', `stages[${index}].stageId が不正です`);
  }
  if (!finiteNumber(raw.score)) {
    throw ApiError.unprocessable('invalid_stage_score', `stages[${index}].score が不正です`);
  }
  if (!finiteNumber(raw.durationMs)) {
    throw ApiError.unprocessable('invalid_duration', `stages[${index}].durationMs が不正です`);
  }

  const metricsRaw = raw.metrics ?? {};
  if (!isRecord(metricsRaw)) {
    throw ApiError.unprocessable('invalid_metrics', `stages[${index}].metrics が不正です`);
  }

  const entries = Object.entries(metricsRaw);
  if (entries.length > MAX_METRICS_PER_STAGE) {
    throw ApiError.unprocessable('too_many_metrics', `stages[${index}] のメトリクスが多すぎます`);
  }

  const metrics: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (key.length > MAX_METRIC_KEY_LENGTH || !METRIC_KEY.test(key)) {
      throw ApiError.unprocessable(
        'invalid_metric_key',
        `stages[${index}] のメトリクス名が不正です`,
      );
    }
    if (!finiteNumber(value)) {
      throw ApiError.unprocessable('invalid_metric', `stages[${index}].metrics.${key} が不正です`);
    }
    metrics[key] = value;
  }

  return {
    stageId: stageId as StageId,
    score: Math.trunc(raw.score),
    durationMs: Math.trunc(raw.durationMs),
    metrics,
  };
}
