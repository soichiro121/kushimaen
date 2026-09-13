<?php

declare(strict_types=1);

namespace Komato\Api\Validation;

use Komato\Api\Domain\StageSubmission;
use Komato\Api\Http\ApiException;

/**
 * Shape validation for `POST /api/runs/{runId}/complete`.
 *
 * This is the first gate: it turns an arbitrary JSON blob into typed objects, or
 * fails with 422. Nothing downstream has to re-check types.
 *
 * The limits here are about resource protection (how big a payload we are willing to
 * parse at all); game-rule limits belong to `StageResultValidator`.
 */
final class SubmissionRequestValidator
{
    private const MAX_STAGES = 12;
    private const MAX_METRICS_PER_STAGE = 40;
    private const MAX_METRIC_KEY_LENGTH = 48;

    /**
     * @param mixed $body decoded JSON
     * @return array{nickname: string, stages: list<StageSubmission>, totalScore: int}
     */
    public function parse(mixed $body): array
    {
        if (!is_array($body)) {
            throw ApiException::unprocessable('invalid_body', 'Request body must be a JSON object');
        }

        $nickname = $body['nickname'] ?? null;
        if (!is_string($nickname)) {
            throw ApiException::unprocessable('invalid_nickname', 'nickname must be a string');
        }
        if (strlen($nickname) > 256) {
            // Length in BYTES here: the character-level rule is applied after sanitising.
            throw ApiException::unprocessable('invalid_nickname', 'nickname is too long');
        }

        $stagesRaw = $body['stages'] ?? null;
        if (!is_array($stagesRaw) || !array_is_list($stagesRaw)) {
            throw ApiException::unprocessable('invalid_stages', 'stages must be an array');
        }
        if (count($stagesRaw) > self::MAX_STAGES) {
            throw ApiException::unprocessable('too_many_stages', 'too many stages submitted');
        }

        $stages = [];
        foreach ($stagesRaw as $index => $stageRaw) {
            $stages[] = $this->parseStage($stageRaw, (int) $index);
        }

        $totalScore = $body['totalScore'] ?? 0;
        if (!is_int($totalScore) && !is_float($totalScore)) {
            throw ApiException::unprocessable('invalid_total', 'totalScore must be a number');
        }

        return [
            'nickname' => $nickname,
            'stages' => $stages,
            'totalScore' => (int) $totalScore,
        ];
    }

    private function parseStage(mixed $raw, int $index): StageSubmission
    {
        if (!is_array($raw)) {
            throw ApiException::unprocessable('invalid_stage', "stages[{$index}] must be an object");
        }

        $stageId = $raw['stageId'] ?? null;
        if (!is_string($stageId) || !preg_match('/^[a-z][a-zA-Z0-9_]{0,31}$/', $stageId)) {
            throw ApiException::unprocessable('invalid_stage_id', "stages[{$index}].stageId is invalid");
        }

        $score = $raw['score'] ?? null;
        if (!is_int($score) && !is_float($score)) {
            throw ApiException::unprocessable('invalid_stage_score', "stages[{$index}].score must be a number");
        }

        $durationMs = $raw['durationMs'] ?? null;
        if (!is_int($durationMs) && !is_float($durationMs)) {
            throw ApiException::unprocessable('invalid_duration', "stages[{$index}].durationMs must be a number");
        }

        $metricsRaw = $raw['metrics'] ?? [];
        if (!is_array($metricsRaw)) {
            throw ApiException::unprocessable('invalid_metrics', "stages[{$index}].metrics must be an object");
        }
        if (count($metricsRaw) > self::MAX_METRICS_PER_STAGE) {
            throw ApiException::unprocessable('too_many_metrics', "stages[{$index}] has too many metrics");
        }

        $metrics = [];
        foreach ($metricsRaw as $key => $value) {
            if (!is_string($key) || !preg_match('/^[a-zA-Z][a-zA-Z0-9_]*$/', $key)) {
                throw ApiException::unprocessable('invalid_metric_key', "stages[{$index}] has an invalid metric name");
            }
            if (strlen($key) > self::MAX_METRIC_KEY_LENGTH) {
                throw ApiException::unprocessable('invalid_metric_key', "stages[{$index}] metric name is too long");
            }
            if (!is_int($value) && !is_float($value)) {
                throw ApiException::unprocessable('invalid_metric', "stages[{$index}].metrics.{$key} must be a number");
            }
            if (!is_finite((float) $value)) {
                throw ApiException::unprocessable('invalid_metric', "stages[{$index}].metrics.{$key} must be finite");
            }
            $metrics[$key] = $value;
        }

        return new StageSubmission($stageId, (int) $score, (int) $durationMs, $metrics);
    }
}
