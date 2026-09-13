<?php

declare(strict_types=1);

namespace Komato\Api\Tests;

/** Ranking, period filtering and the caller's own placement. */
final class LeaderboardApiTest extends TestCase
{
    /** Plays a full run and returns its id. `$scale` shifts the score up or down. */
    private function submitRun(string $nickname, int $nearMissCount): string
    {
        $runId = $this->openRun();
        $stages = $this->validStages();
        $stages[0]['metrics']['nearMissCount'] = $nearMissCount;
        // Read the cap from the rule set rather than hard-coding it: combo units are
        // bounded by the number of near misses that produced them, and a literal here
        // silently invalidates every fixture the next time the balance is tuned.
        $stages[0]['metrics']['comboUnits'] = min(
            $stages[0]['metrics']['comboUnits'],
            $nearMissCount * $this->rules()->int('stages.late.scoring.maxComboUnitsPerHit'),
        );
        $stages[0]['score'] = $this->calculator()->stageScore('late', $stages[0]['metrics']);

        $response = $this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => $nickname,
            'stages' => $stages,
            'totalScore' => 0,
        ]);
        self::assertTrue($this->json($response)['accepted'], 'fixture submission was rejected');

        return $runId;
    }

    public function testEntriesAreOrderedByScoreDescending(): void
    {
        $this->submitRun('ひくい', 2);
        $this->submitRun('たかい', 40);
        $this->submitRun('まんなか', 20);

        $body = $this->json($this->request('GET', '/api/leaderboard?period=all'));
        $names = array_column($body['entries'], 'nickname');

        self::assertSame(['たかい', 'まんなか', 'ひくい'], $names);
        self::assertSame([1, 2, 3], array_column($body['entries'], 'rank'));
        self::assertSame(3, $body['total']);
    }

    public function testTiesAreBrokenByTheEarlierSubmission(): void
    {
        $this->submitRun('さきに', 10);
        $this->clock->advance('+1 minute');
        $this->submitRun('あとから', 10);

        $body = $this->json($this->request('GET', '/api/leaderboard?period=all'));

        self::assertSame('さきに', $body['entries'][0]['nickname']);
        self::assertSame('あとから', $body['entries'][1]['nickname']);
    }

    public function testTodayExcludesOlderEntriesWhileAllTimeKeepsThem(): void
    {
        $this->submitRun('きのう', 30);
        $this->clock->advance('+2 days');
        $this->submitRun('きょう', 5);

        $today = $this->json($this->request('GET', '/api/leaderboard?period=today'));
        $all = $this->json($this->request('GET', '/api/leaderboard?period=all'));

        self::assertSame(['きょう'], array_column($today['entries'], 'nickname'));
        self::assertSame(['きのう', 'きょう'], array_column($all['entries'], 'nickname'));
    }

    public function testOwnPlacementIsReturnedEvenWhenOutsideTheTopPage(): void
    {
        $mine = $this->submitRun('わたし', 2);
        for ($i = 0; $i < 4; $i++) {
            $this->submitRun("つよい{$i}", 30 + $i);
        }

        $body = $this->json($this->request('GET', "/api/leaderboard?period=all&limit=2&runId={$mine}"));

        self::assertCount(2, $body['entries']);
        self::assertNotNull($body['me']);
        self::assertSame('わたし', $body['me']['nickname']);
        self::assertSame(5, $body['me']['rank']);
    }

    public function testOwnRowIsFlaggedInsideThePage(): void
    {
        $mine = $this->submitRun('わたし', 40);
        $this->submitRun('ほか', 2);

        $body = $this->json($this->request('GET', "/api/leaderboard?period=all&runId={$mine}"));

        self::assertTrue($body['entries'][0]['isMe']);
        self::assertFalse($body['entries'][1]['isMe']);
    }

    public function testRejectedEntriesNeverAppear(): void
    {
        $this->submitRun('しょうじき', 10);

        // A submission whose metrics do not support its claimed score.
        $runId = $this->openRun();
        $stages = $this->validStages();
        foreach ($stages as $index => $stage) {
            $stages[$index]['score'] = 999999;
        }
        $this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'ずる',
            'stages' => $stages,
            'totalScore' => 999999,
        ]);

        $body = $this->json($this->request('GET', '/api/leaderboard?period=all'));

        self::assertSame(['しょうじき'], array_column($body['entries'], 'nickname'));
        self::assertSame(1, $body['total']);
    }

    /**
     * Scores from a different balance version are not comparable, so they must not
     * share a ranking. Without this the first rebalance would leave old, inflated
     * totals permanently on top of the board.
     */
    public function testScoresFromAnOlderRuleSetAreNotRanked(): void
    {
        $this->submitRun('いま', 10);

        // A score from the previous balance, with a total nobody can reach today.
        $this->pdo->exec(
            "INSERT INTO runs (id, seed, config_version, started_at, expires_at, completed_at, status)
             VALUES ('00000000-0000-4000-8000-00000000old', 1, 1,
                     '2026-05-01 08:00:00', '2026-05-01 08:30:00', '2026-05-01 08:10:00', 'completed')"
        );
        $this->pdo->exec(
            "INSERT INTO scores
                (run_id, nickname, total_score, created_at, valid, suspicion_score, config_version)
             VALUES ('00000000-0000-4000-8000-00000000old', 'むかし', 999999,
                     '2026-05-01 08:10:00', 1, 0, 1)"
        );

        $body = $this->json($this->request('GET', '/api/leaderboard?period=all'));

        self::assertSame(['いま'], array_column($body['entries'], 'nickname'));
        self::assertSame(1, $body['total']);
    }

    public function testAnEmptyBoardIsAnEmptyListNotAnError(): void
    {
        $response = $this->request('GET', '/api/leaderboard?period=today');
        $body = $this->json($response);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame([], $body['entries']);
        self::assertNull($body['me']);
        self::assertSame(0, $body['total']);
    }

    public function testLimitIsClampedSoAClientCannotAskForTheWholeTable(): void
    {
        $this->submitRun('ひとり', 10);

        $body = $this->json($this->request('GET', '/api/leaderboard?period=all&limit=100000'));

        self::assertSame(200, 200);
        self::assertLessThanOrEqual(100, count($body['entries']));
    }

    public function testAnUnknownPeriodFallsBackToAllTime(): void
    {
        $this->submitRun('だれか', 10);

        $body = $this->json($this->request('GET', '/api/leaderboard?period=%27%20OR%201%3D1--'));

        self::assertSame('all', $body['period']);
        self::assertCount(1, $body['entries']);
    }
}
