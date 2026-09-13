<?php

declare(strict_types=1);

namespace Komato\Api\Validation;

use Komato\Api\Config\RuleSet;
use Komato\Api\Domain\StageSubmission;
use Komato\Api\Domain\ValidationIssue;
use Komato\Api\Domain\ValidationOutcome;
use Komato\Api\Service\ScoreCalculator;

/**
 * Anti-cheat validation for a whole submission.
 *
 * MIRRORS: `src/services/run/validation.ts` (the client copy powers LOCAL MODE).
 * This one is authoritative.
 *
 * The goal is explicitly NOT perfect cheat prevention - that is impossible for a
 * client-side game. The goal is that editing `totalScore` in DevTools and POSTing it
 * cannot put you on top of the leaderboard. That is achieved by:
 *
 *   1. never storing the client's score - it is recomputed from the metrics,
 *   2. bounding every metric by what the game can physically produce,
 *   3. bounding play time at both ends,
 *   4. rejecting duplicate, expired and unknown runs.
 *
 * So a forger has to submit a *self-consistent* set of metrics that are all within
 * human limits, which is a far higher bar than editing one number.
 */
final class StageResultValidator
{
    private const REJECT_THRESHOLD = 50;

    public function __construct(
        private readonly RuleSet $rules,
        private readonly ScoreCalculator $calculator,
    ) {
    }

    /**
     * @param list<StageSubmission> $stages
     */
    public function validate(array $stages): ValidationOutcome
    {
        /** @var list<ValidationIssue> $issues */
        $issues = [];
        $stageScores = [];
        $totalScore = 0;
        $totalDuration = 0;

        if ($stages === []) {
            $issues[] = new ValidationIssue('no_stages', 'submission contains no stages', 100);
        }

        $seen = [];
        foreach ($stages as $stage) {
            if (!$this->rules->hasStage($stage->stageId)) {
                $issues[] = new ValidationIssue('unknown_stage', "unknown stage {$stage->stageId}", 100);
                continue;
            }
            if (isset($seen[$stage->stageId])) {
                $issues[] = new ValidationIssue(
                    'duplicate_stage',
                    "stage {$stage->stageId} submitted twice",
                    100
                );
                continue;
            }
            $seen[$stage->stageId] = true;

            $totalDuration += $stage->durationMs;
            array_push($issues, ...$this->durationIssues($stage));
            array_push($issues, ...$this->metricIssues($stage));

            $recomputed = $this->calculator->stageScore($stage->stageId, $stage->metrics);
            $stageScores[$stage->stageId] = $recomputed;
            $totalScore += $recomputed;

            if ($recomputed > $this->calculator->maxPlausibleStageScore($stage->stageId)) {
                $issues[] = new ValidationIssue(
                    'impossible_score',
                    "{$stage->stageId} score exceeds the theoretical maximum",
                    100
                );
            }
            if ($stage->score !== $recomputed) {
                // Not automatically cheating: an outdated client or a rounding change
                // produces this too. It raises suspicion; the server's number wins.
                $issues[] = new ValidationIssue(
                    'score_mismatch',
                    "{$stage->stageId}: client said {$stage->score}, server computed {$recomputed}",
                    25
                );
            }
        }

        if ($stages !== [] && $totalDuration < $this->rules->int('run.minTotalDurationMs')) {
            $issues[] = new ValidationIssue('run_too_short', 'the whole run was impossibly short', 100);
        }
        if ($totalDuration > $this->rules->int('run.maxTotalDurationMs')) {
            $issues[] = new ValidationIssue('run_too_long', 'the whole run took too long', 40);
        }

        $suspicion = min(100, array_sum(array_map(
            static fn (ValidationIssue $issue): int => $issue->weight,
            $issues
        )));

        return new ValidationOutcome(
            $suspicion < self::REJECT_THRESHOLD,
            $totalScore,
            $stageScores,
            $issues,
            $suspicion,
        );
    }

    /** @return list<ValidationIssue> */
    private function durationIssues(StageSubmission $stage): array
    {
        $min = $this->rules->int("stages.{$stage->stageId}.limits.minDurationMs");
        $max = $this->rules->int("stages.{$stage->stageId}.limits.maxDurationMs");

        if ($stage->durationMs < $min) {
            return [new ValidationIssue(
                'duration_too_short',
                "{$stage->stageId} finished impossibly fast ({$stage->durationMs}ms)",
                100
            )];
        }
        if ($stage->durationMs > $max) {
            return [new ValidationIssue(
                'duration_too_long',
                "{$stage->stageId} ran longer than possible ({$stage->durationMs}ms)",
                100
            )];
        }
        return [];
    }

    /** @return list<ValidationIssue> */
    private function metricIssues(StageSubmission $stage): array
    {
        $issues = [];

        foreach ($stage->metrics as $key => $value) {
            if (!is_int($value) && !is_float($value)) {
                $issues[] = new ValidationIssue('metric_not_numeric', "metric {$key} is not a number", 100);
                continue;
            }
            if (!is_finite((float) $value)) {
                $issues[] = new ValidationIssue('metric_not_finite', "metric {$key} is not finite", 100);
            } elseif ($value < 0) {
                $issues[] = new ValidationIssue('metric_negative', "metric {$key} is negative", 100);
            }
        }

        return [...$issues, ...match ($stage->stageId) {
            'late' => $this->lateIssues($stage),
            'bread' => $this->breadIssues($stage),
            'teacher' => $this->teacherIssues($stage),
            default => [],
        }];
    }

    /** @return list<ValidationIssue> */
    private function lateIssues(StageSubmission $stage): array
    {
        $issues = [];

        if ($stage->metric('nearMissCount') > $this->rules->int('stages.late.limits.maxNearMissCount')) {
            $issues[] = new ValidationIssue('late_near_miss', 'nearMissCount above the cap', 100);
        }
        if ($stage->metric('collisionCount') > $this->rules->int('stages.late.limits.maxCollisionCount')) {
            $issues[] = new ValidationIssue('late_collisions', 'collisionCount above the cap', 60);
        }
        $maxCombo = $stage->metric('nearMissCount') * $this->rules->int('stages.late.scoring.maxComboUnitsPerHit');
        if ($stage->metric('comboUnits') > $maxCombo) {
            $issues[] = new ValidationIssue('late_combo_units', 'comboUnits exceed what nearMissCount allows', 100);
        }
        if ($stage->metric('timeRemainingSec') > $this->rules->int('stages.late.limits.maxTimeRemainingSec')) {
            $issues[] = new ValidationIssue('late_time_remaining', 'timeRemainingSec above the time limit', 100);
        }
        if ($stage->metric('goalReached') > 1) {
            $issues[] = new ValidationIssue('late_goal', 'goalReached must be 0 or 1', 100);
        }
        if ($stage->metric('timeRemainingSec') > 0 && $stage->metric('goalReached') < 1) {
            $issues[] = new ValidationIssue('late_time_without_goal', 'time bonus without reaching the gate', 100);
        }

        return $issues;
    }

    /** @return list<ValidationIssue> */
    private function breadIssues(StageSubmission $stage): array
    {
        $issues = [];
        $questions = $stage->metric('questionCount');

        if (
            $questions < $this->rules->int('stages.bread.minQuestions')
            || $questions > $this->rules->int('stages.bread.maxQuestions')
        ) {
            $issues[] = new ValidationIssue('bread_questions', 'questionCount outside the configured range', 100);
        }
        if ($stage->metric('correctCount') > $questions) {
            $issues[] = new ValidationIssue('bread_correct', 'more correct answers than questions', 100);
        }
        $maxSpeed = $stage->metric('correctCount') * $this->rules->int('stages.bread.maxSpeedUnitsPerQuestion');
        if ($stage->metric('speedUnits') > $maxSpeed) {
            $issues[] = new ValidationIssue('bread_speed_units', 'speedUnits exceed what correctCount allows', 100);
        }
        $maxCombo = $stage->metric('correctCount') * $this->rules->int('stages.bread.scoring.maxComboUnitsPerHit');
        if ($stage->metric('comboUnits') > $maxCombo) {
            $issues[] = new ValidationIssue('bread_combo_units', 'comboUnits exceed what correctCount allows', 100);
        }
        if ($stage->metric('mistakeCount') > $this->rules->int('stages.bread.limits.maxMistakeCount')) {
            $issues[] = new ValidationIssue('bread_mistakes', 'mistakeCount above the cap', 60);
        }

        return $issues;
    }

    /**
     * STAGE 3 - the stealth run (requirement 40).
     *
     * There are no per-action counters to bound here the way the other stages have,
     * so the checks are about internal consistency instead: a clear implies reaching
     * the exit, a time bonus implies a clear, the distance walked has to be possible
     * in the time reported, and the bonuses have to agree with the exposure counters.
     *
     * @return list<ValidationIssue>
     */
    private function teacherIssues(StageSubmission $stage): array
    {
        $issues = [];

        $cleared = $stage->metric('cleared');
        $checkpoints = $stage->metric('checkpointsCompleted');
        $caught = $stage->metric('caughtCount');
        $detections = $stage->metric('detectionCount');
        $timeRemaining = $stage->metric('timeRemainingSec');

        if ($cleared > 1) {
            $issues[] = new ValidationIssue('teacher_cleared_flag', 'cleared must be 0 or 1', 100);
        }
        if ($checkpoints > $this->rules->int('stages.teacher.limits.maxCheckpointCount')) {
            $issues[] = new ValidationIssue('teacher_checkpoints', 'checkpointsCompleted above the cap', 100);
        }
        // Reaching the exit is itself a checkpoint, so a clear can never be cheaper
        // than one objective plus the exit.
        if ($cleared > 0 && $checkpoints < $this->rules->int('stages.teacher.limits.minCheckpointCount')) {
            $issues[] = new ValidationIssue(
                'teacher_cleared_without_checkpoints',
                'cleared with too few checkpoints collected',
                100
            );
        }
        if ($caught > $this->rules->int('stages.teacher.limits.maxCaughtCount')) {
            $issues[] = new ValidationIssue('teacher_caught', 'caughtCount above the cap', 60);
        }
        if ($detections > $this->rules->int('stages.teacher.limits.maxDetectionCount')) {
            $issues[] = new ValidationIssue('teacher_detections', 'detectionCount above the cap', 60);
        }
        // Every catch starts with being spotted, so one can never exceed the other.
        if ($caught > $detections) {
            $issues[] = new ValidationIssue(
                'teacher_caught_without_detection',
                'more catches than detections',
                100
            );
        }

        // -- bonuses have to be earned -------------------------------------
        if ($timeRemaining > 0 && $cleared < 1) {
            $issues[] = new ValidationIssue(
                'teacher_time_without_clear',
                'time bonus without reaching the exit',
                100
            );
        }
        $timeLimitMs = $this->rules->int('stages.teacher.timeLimitSec') * 1000;
        if ($timeRemaining > $this->rules->int('stages.teacher.limits.maxTimeRemainingSec')) {
            $issues[] = new ValidationIssue('teacher_time_remaining', 'timeRemainingSec above the time limit', 100);
        }
        // +1 second of slack absorbs the client's flooring and one frame of drift.
        $possibleRemaining = (int) ceil(max(0, $timeLimitMs - $stage->durationMs) / 1000) + 1;
        if ($timeRemaining > $possibleRemaining) {
            $issues[] = new ValidationIssue(
                'teacher_time_impossible',
                "timeRemainingSec {$timeRemaining} impossible in {$stage->durationMs}ms",
                100
            );
        }
        if ($stage->metric('dangerPassCount') > $this->rules->int('stages.teacher.scoring.maxDangerPassCount')) {
            // The formula clamps this, so it costs nothing - but it should never happen.
            $issues[] = new ValidationIssue('teacher_danger_passes', 'dangerPassCount above the cap', 40);
        }
        if ($stage->metric('perfectStealth') > 0 && ($caught > 0 || $detections > 0)) {
            $issues[] = new ValidationIssue(
                'teacher_perfect_stealth_flag',
                'perfectStealth reported alongside exposure',
                40
            );
        }

        // -- movement has to be physically possible ------------------------
        $routeDistance = $stage->metric('routeDistance');
        if ($routeDistance > $this->rules->int('stages.teacher.limits.maxRouteDistancePx')) {
            $issues[] = new ValidationIssue('teacher_route_distance', 'routeDistance above the cap', 100);
        }
        // 15% headroom covers frame-rate jitter and the diagonal of a rounded path.
        $maxTravel = ($stage->durationMs / 1000)
            * $this->rules->int('stages.teacher.limits.maxPlayerSpeedPxPerSec') * 1.15 + 400;
        if ($routeDistance > $maxTravel) {
            $issues[] = new ValidationIssue(
                'teacher_speed_hack',
                "routeDistance {$routeDistance} impossible in {$stage->durationMs}ms",
                100
            );
        }
        if ($stage->metric('idleTimeMs') > $stage->durationMs) {
            $issues[] = new ValidationIssue('teacher_idle_time', 'idleTimeMs exceeds the stage duration', 100);
        }

        return $issues;
    }
}
