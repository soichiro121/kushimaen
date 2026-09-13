<?php

declare(strict_types=1);

namespace Komato\Api\Service;

use Komato\Api\Config\RuleSet;
use RuntimeException;

/**
 * Server-authoritative score calculation.
 *
 * MIRRORS: `src/game/core/scoring.ts` on the frontend.
 *
 * The client's `totalScore` is never stored. Every stage score is recomputed here
 * from the submitted metrics using the constants in the SAME shared rule-set file
 * the client reads, and the golden vectors in
 * `shared/game-rules/score-fixtures.json` are asserted by both test suites - so a
 * formula change on one side alone turns the other side red.
 *
 * Why recomputation is possible at all: every stage accumulates its scoring inputs
 * into integer metrics (see the "integer units" note in shared/game-rules/README.md),
 * so a score is a pure function of (metrics, rules) with no timing involved.
 */
final class ScoreCalculator
{
    public function __construct(private readonly RuleSet $rules)
    {
    }

    /**
     * @param array<string, float|int> $metrics
     */
    public function stageScore(string $stageId, array $metrics): int
    {
        return max(0, $this->rawStageScore($stageId, $metrics));
    }

    /**
     * Score before the zero clamp. Only used for diagnostics; the clamped value is
     * what gets stored.
     *
     * @param array<string, float|int> $metrics
     */
    public function rawStageScore(string $stageId, array $metrics): int
    {
        return match ($stageId) {
            'late' => $this->lateRaw($metrics),
            'bread' => $this->breadRaw($metrics),
            'teacher' => $this->teacherRaw($metrics),
            default => throw new RuntimeException("No score formula for stage \"{$stageId}\""),
        };
    }

    /**
     * @param array<string, float|int> $metrics
     */
    private function lateRaw(array $metrics): int
    {
        $nearMiss = $this->read($metrics, 'nearMissCount') * $this->rules->int('stages.late.scoring.nearMissScore');
        $combo = $this->read($metrics, 'comboUnits') * $this->rules->int('stages.late.scoring.comboUnitScore');
        $collision = $this->read($metrics, 'collisionCount') * $this->rules->int('stages.late.scoring.collisionPenalty');

        $goal = 0.0;
        if ($this->read($metrics, 'goalReached') > 0) {
            $goal = $this->rules->int('stages.late.scoring.goalBonus')
                + $this->read($metrics, 'timeRemainingSec') * $this->rules->int('stages.late.scoring.timeBonusPerSecond');
        }

        return (int) round($nearMiss + $combo + $goal - $collision);
    }

    /**
     * The number of orders in a run is random (6-10) and every term scales with it,
     * so without normalisation a player who drew 10 orders scored roughly 1.9x one
     * who drew 6, for no reason they controlled. The score is therefore scaled to a
     * fixed reference length.
     *
     * MIRRORS: `breadQuestionNormalisation` in src/game/core/scoring.ts.
     *
     * `questionCount` is a submitted metric, so this stays exactly recomputable. It
     * is clamped to the configured range first, which keeps the function total even
     * for a malformed submission (the validator rejects those separately).
     */
    public function breadQuestionNormalisation(float $questionCount): float
    {
        $min = $this->rules->int('stages.bread.minQuestions');
        $max = $this->rules->int('stages.bread.maxQuestions');

        $questions = (int) round($questionCount);
        if ($questions <= 0) {
            $questions = $min;
        }
        $questions = max($min, min($max, $questions));

        return $this->rules->int('stages.bread.referenceQuestions') / $questions;
    }

    /**
     * @param array<string, float|int> $metrics
     */
    private function breadRaw(array $metrics): int
    {
        $earned = $this->read($metrics, 'correctCount') * $this->rules->int('stages.bread.scoring.correctScore')
            + $this->read($metrics, 'speedUnits') * $this->rules->int('stages.bread.scoring.speedUnitScore')
            + $this->read($metrics, 'comboUnits') * $this->rules->int('stages.bread.scoring.comboUnitScore')
            - $this->read($metrics, 'mistakeCount') * $this->rules->int('stages.bread.scoring.mistakePenalty');

        return (int) round($earned * $this->breadQuestionNormalisation($this->read($metrics, 'questionCount')));
    }

    /**
     * The most time a legal run can possibly have left on the clock.
     *
     * Even a perfect escape takes `minDurationMs`, so the raw time limit is not the
     * ceiling. Both the formula and its upper bound clamp to this, which is what
     * stops a submitted `timeRemainingSec` of 90 scoring above the stage's own
     * maximum - a PHPUnit case pins exactly that.
     *
     * MIRRORS: `teacherBestRemainingSec` in src/game/core/scoring.ts.
     */
    public function teacherBestRemainingSec(): int
    {
        return max(0, min(
            $this->rules->int('stages.teacher.limits.maxTimeRemainingSec'),
            $this->rules->int('stages.teacher.timeLimitSec')
            - (int) ceil($this->rules->int('stages.teacher.limits.minDurationMs') / 1000)
        ));
    }

    /**
     * STAGE 3 - the stealth run. MIRRORS `teacherRaw` in src/game/core/scoring.ts.
     *
     * Time is the spine of the score, which is what stops "wait in a safe corner"
     * being optimal. Perfect stealth is DERIVED from the exposure counters rather
     * than read from the client's `perfectStealth` flag, so a forged flag buys
     * nothing.
     *
     * @param array<string, float|int> $metrics
     */
    private function teacherRaw(array $metrics): int
    {
        $cleared = $this->read($metrics, 'cleared') > 0;
        $caught = $this->read($metrics, 'caughtCount');
        $detections = $this->read($metrics, 'detectionCount');

        $checkpoints = $this->clamp(
            $this->read($metrics, 'checkpointsCompleted'),
            0.0,
            (float) $this->rules->int('stages.teacher.limits.maxCheckpointCount')
        );
        $dangerPasses = $this->clamp(
            $this->read($metrics, 'dangerPassCount'),
            0.0,
            (float) $this->rules->int('stages.teacher.scoring.maxDangerPassCount')
        );
        // Only time saved beyond the free allowance scores - the stage's generous
        // safety limit is not a target.
        $timeRemaining = $cleared
            ? max(
                0.0,
                $this->clamp(
                    $this->read($metrics, 'timeRemainingSec'),
                    0.0,
                    (float) $this->teacherBestRemainingSec()
                ) - $this->rules->int('stages.teacher.scoring.timeBonusFreeSec')
            )
            : 0.0;

        $total = $checkpoints * $this->rules->int('stages.teacher.scoring.checkpointScore')
            + $dangerPasses * $this->rules->int('stages.teacher.scoring.dangerBonus');

        if ($cleared) {
            $total += $this->rules->int('stages.teacher.scoring.clearBonus')
                + $timeRemaining * $this->rules->int('stages.teacher.scoring.timeBonusPerSecond');
            if ($caught <= 0) {
                $total += $this->rules->int('stages.teacher.scoring.noCaughtBonus');
            }
            if ($caught <= 0 && $detections <= 0) {
                $total += $this->rules->int('stages.teacher.scoring.perfectStealthBonus');
            }
        }

        return (int) round($total - $caught * $this->rules->int('stages.teacher.scoring.caughtPenalty'));
    }

    /**
     * The theoretical maximum for a stage. A recomputed score above this means the
     * bounds in the rule set and the formula have drifted apart, which is a bug worth
     * failing loudly on rather than accepting into a leaderboard.
     */
    public function maxPlausibleStageScore(string $stageId): int
    {
        return match ($stageId) {
            'late' => $this->rules->int('stages.late.limits.maxNearMissCount')
                * $this->rules->int('stages.late.scoring.nearMissScore')
                + $this->rules->int('stages.late.limits.maxNearMissCount')
                * $this->rules->int('stages.late.scoring.maxComboUnitsPerHit')
                * $this->rules->int('stages.late.scoring.comboUnitScore')
                + $this->rules->int('stages.late.scoring.goalBonus')
                + $this->rules->int('stages.late.limits.maxTimeRemainingSec')
                * $this->rules->int('stages.late.scoring.timeBonusPerSecond'),

            'bread' => $this->maxBreadScore(),

            'teacher' => $this->maxTeacherScore(),

            default => throw new RuntimeException("No score bound for stage \"{$stageId}\""),
        };
    }

    /** The shortest run carries the largest normalisation factor, so that is the bound. */
    private function maxBreadScore(): int
    {
        $perfect = $this->rules->int('stages.bread.maxQuestions')
            * $this->rules->int('stages.bread.scoring.correctScore')
            + $this->rules->int('stages.bread.maxQuestions')
            * $this->rules->int('stages.bread.maxSpeedUnitsPerQuestion')
            * $this->rules->int('stages.bread.scoring.speedUnitScore')
            + $this->rules->int('stages.bread.maxQuestions')
            * $this->rules->int('stages.bread.scoring.maxComboUnitsPerHit')
            * $this->rules->int('stages.bread.scoring.comboUnitScore');

        return (int) ceil(
            $perfect * $this->breadQuestionNormalisation((float) $this->rules->int('stages.bread.minQuestions'))
        );
    }

    private function maxTeacherScore(): int
    {
        $bestRemaining = $this->teacherBestRemainingSec();

        return $this->rules->int('stages.teacher.scoring.clearBonus')
            + $this->rules->int('stages.teacher.limits.maxCheckpointCount')
            * $this->rules->int('stages.teacher.scoring.checkpointScore')
            + max(0, $bestRemaining - $this->rules->int('stages.teacher.scoring.timeBonusFreeSec'))
            * $this->rules->int('stages.teacher.scoring.timeBonusPerSecond')
            + $this->rules->int('stages.teacher.scoring.noCaughtBonus')
            + $this->rules->int('stages.teacher.scoring.perfectStealthBonus')
            + $this->rules->int('stages.teacher.scoring.maxDangerPassCount')
            * $this->rules->int('stages.teacher.scoring.dangerBonus');
    }

    private function clamp(float $value, float $min, float $max): float
    {
        return max($min, min($max, $value));
    }

    /** Missing metrics read as 0, exactly as on the client. */
    private function read(array $metrics, string $key): float
    {
        $value = $metrics[$key] ?? 0;
        if (!is_int($value) && !is_float($value)) {
            return 0.0;
        }
        return is_finite((float) $value) ? (float) $value : 0.0;
    }
}
