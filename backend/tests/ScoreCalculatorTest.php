<?php

declare(strict_types=1);

namespace Komato\Api\Tests;

use Komato\Api\Config\RuleSet;
use Komato\Api\Service\ScoreCalculator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase as BaseTestCase;
use RuntimeException;

/**
 * The frontend/backend agreement test.
 *
 * It reads `shared/game-rules/score-fixtures.json` - the SAME file asserted by
 * `tests/scoring.test.ts` on the frontend. If either side's formula changes without
 * the other, one of the two suites goes red. That is the whole point.
 */
final class ScoreCalculatorTest extends BaseTestCase
{
    private static function fixtures(): array
    {
        foreach ([
            dirname(__DIR__, 2) . '/shared/game-rules/score-fixtures.json',
            dirname(__DIR__) . '/shared/game-rules/score-fixtures.json',
        ] as $candidate) {
            if (is_readable($candidate)) {
                return json_decode((string) file_get_contents($candidate), true, 32, JSON_THROW_ON_ERROR);
            }
        }
        throw new RuntimeException('score-fixtures.json not found');
    }

    public static function stageScoreProvider(): array
    {
        $cases = [];
        foreach (self::fixtures()['stageScores'] as $fixture) {
            $cases[$fixture['name']] = [$fixture['stageId'], $fixture['metrics'], $fixture['expected']];
        }
        return $cases;
    }

    #[DataProvider('stageScoreProvider')]
    public function testMatchesTheSharedGoldenVectors(string $stageId, array $metrics, int $expected): void
    {
        $calculator = new ScoreCalculator(RuleSet::load());

        self::assertSame(
            $expected,
            $calculator->stageScore($stageId, $metrics),
            "PHP and TypeScript disagree about the {$stageId} score. "
            . 'Check src/game/core/scoring.ts and src/Service/ScoreCalculator.php.'
        );
    }

    public function testScoreNeverGoesNegative(): void
    {
        $calculator = new ScoreCalculator(RuleSet::load());

        self::assertSame(0, $calculator->stageScore('late', ['collisionCount' => 99]));
        self::assertLessThan(0, $calculator->rawStageScore('late', ['collisionCount' => 99]));
    }

    public function testUnknownStageIsRejectedRatherThanScoredAsZero(): void
    {
        $calculator = new ScoreCalculator(RuleSet::load());

        $this->expectException(RuntimeException::class);
        $calculator->stageScore('does-not-exist', []);
    }

    public function testEveryStageHasAPositiveUpperBound(): void
    {
        $rules = RuleSet::load();
        $calculator = new ScoreCalculator($rules);

        foreach ($rules->stageOrder() as $stageId) {
            self::assertGreaterThan(
                0,
                $calculator->maxPlausibleStageScore($stageId),
                "Stage {$stageId} has no usable score bound"
            );
        }
    }
}
