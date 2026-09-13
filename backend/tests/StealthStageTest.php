<?php

declare(strict_types=1);

namespace Komato\Api\Tests;

use Komato\Api\Config\RuleSet;
use Komato\Api\Service\ScoreCalculator;

/**
 * Stage 3 (the stealth run) anti-cheat, through the real HTTP stack.
 *
 * This stage has no per-action counters to bound the way the other two do - there is
 * no "taps per second" to cap. Its integrity rests on internal consistency instead:
 * a clear implies reaching the exit, a time bonus implies a clear, the distance
 * walked has to fit in the time reported, and the bonuses have to agree with the
 * exposure counters. Each of those is asserted here.
 *
 * MIRRORS: the stage-3 block of `tests/validation.test.ts` on the frontend.
 */
final class StealthStageTest extends TestCase
{
    /**
     * Submits a run whose stage-3 metrics are the honest ones with `$overrides`
     * applied, and returns the decoded response.
     *
     * @param array<string, int> $overrides
     * @return array<string, mixed>
     */
    private function submitWithTeacherMetrics(array $overrides, ?int $durationMs = null): array
    {
        $runId = $this->openRun();
        $stages = $this->validStages();

        foreach ($stages as $index => $stage) {
            if ($stage['stageId'] !== 'teacher') {
                continue;
            }
            $metrics = array_merge($stage['metrics'], $overrides);
            $stages[$index]['metrics'] = $metrics;
            $stages[$index]['durationMs'] = $durationMs ?? $stage['durationMs'];
            // The client's score always agrees with its own metrics - the point of
            // these tests is the metrics, not a mismatched number.
            $stages[$index]['score'] = $this->calculator()->stageScore('teacher', $metrics);
        }

        return $this->json($this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'ステルス',
            'stages' => $stages,
            'totalScore' => 0,
        ]));
    }

    public function testAnHonestStealthRunIsAccepted(): void
    {
        $body = $this->submitWithTeacherMetrics([]);

        self::assertTrue($body['accepted']);
        self::assertGreaterThan(0, $body['stageScores']['teacher']);
    }

    public function testClearingWithoutCollectingTheObjectivesIsRejected(): void
    {
        $body = $this->submitWithTeacherMetrics([
            'cleared' => 1,
            'checkpointsCompleted' => 0,
        ]);

        self::assertFalse($body['accepted']);
    }

    public function testATimeBonusWithoutAnEscapeIsRejected(): void
    {
        $body = $this->submitWithTeacherMetrics([
            'cleared' => 0,
            'timeRemainingSec' => 50,
        ]);

        self::assertFalse($body['accepted']);
    }

    public function testBankingMoreTimeThanTheClockCouldHaveLeftIsRejected(): void
    {
        // 49 seconds of play out of a 90-second limit leaves about 41, not 80.
        $body = $this->submitWithTeacherMetrics(['timeRemainingSec' => 80]);

        self::assertFalse($body['accepted']);
    }

    public function testWalkingFurtherThanIsPhysicallyPossibleIsRejected(): void
    {
        $body = $this->submitWithTeacherMetrics(['routeDistance' => 55_000]);

        self::assertFalse($body['accepted']);
    }

    public function testMoreCatchesThanSightingsIsRejected(): void
    {
        // Every catch begins with being spotted, so this combination cannot occur.
        $body = $this->submitWithTeacherMetrics([
            'caughtCount' => 4,
            'detectionCount' => 1,
        ]);

        self::assertFalse($body['accepted']);
    }

    public function testStandingStillLongerThanTheStageLastedIsRejected(): void
    {
        $body = $this->submitWithTeacherMetrics(['idleTimeMs' => 120_000]);

        self::assertFalse($body['accepted']);
    }

    public function testNegativeMetricsAreRejected(): void
    {
        $body = $this->submitWithTeacherMetrics(['caughtCount' => -5]);

        self::assertFalse($body['accepted']);
    }

    /**
     * The headline property: `perfectStealth` is submitted for the result screen, but
     * the bonus is DERIVED from the exposure counters, so forging the flag is worth
     * exactly nothing.
     */
    public function testAForgedPerfectStealthFlagEarnsNothing(): void
    {
        $calculator = new ScoreCalculator(RuleSet::load());
        $honest = [
            'cleared' => 1,
            'checkpointsCompleted' => 3,
            'timeRemainingSec' => 45,
            'caughtCount' => 1,
            'detectionCount' => 2,
            'dangerPassCount' => 1,
            'routeDistance' => 9200,
            'idleTimeMs' => 4200,
        ];

        self::assertSame(
            $calculator->stageScore('teacher', $honest + ['perfectStealth' => 0]),
            $calculator->stageScore('teacher', $honest + ['perfectStealth' => 1]),
        );
    }

    /** Requirement 32: the danger bonus must not be farmable, in the score itself. */
    public function testDangerPassesAreCappedByTheFormula(): void
    {
        $calculator = new ScoreCalculator(RuleSet::load());
        $rules = RuleSet::load();
        $cap = $rules->int('stages.teacher.scoring.maxDangerPassCount');

        self::assertSame(
            $calculator->stageScore('teacher', ['dangerPassCount' => $cap]),
            $calculator->stageScore('teacher', ['dangerPassCount' => 99_999]),
        );
    }

    public function testTheTimeBonusOnlyPaysForTimeSavedBeyondTheFreeAllowance(): void
    {
        $rules = RuleSet::load();
        $calculator = new ScoreCalculator($rules);
        $free = $rules->int('stages.teacher.scoring.timeBonusFreeSec');

        $base = ['cleared' => 1, 'checkpointsCompleted' => 3, 'caughtCount' => 0, 'detectionCount' => 0];

        // Anything inside the allowance is worth the same: finishing is not speed.
        self::assertSame(
            $calculator->stageScore('teacher', $base + ['timeRemainingSec' => 0]),
            $calculator->stageScore('teacher', $base + ['timeRemainingSec' => $free]),
        );
        self::assertGreaterThan(
            $calculator->stageScore('teacher', $base + ['timeRemainingSec' => $free]),
            $calculator->stageScore('teacher', $base + ['timeRemainingSec' => $free + 10]),
        );
    }

    public function testAnImpossibleScoreCannotBeManufacturedFromValidLookingMetrics(): void
    {
        $calculator = new ScoreCalculator(RuleSet::load());

        // Every metric pushed to its ceiling at once still lands under the bound the
        // validator checks against, so the bound and the formula have not drifted.
        $ceiling = $calculator->stageScore('teacher', [
            'cleared' => 1,
            'checkpointsCompleted' => 999,
            'timeRemainingSec' => 999,
            'dangerPassCount' => 999,
            'caughtCount' => 0,
            'detectionCount' => 0,
        ]);

        self::assertLessThanOrEqual($calculator->maxPlausibleStageScore('teacher'), $ceiling);
    }
}
