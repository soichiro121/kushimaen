<?php

declare(strict_types=1);

namespace Komato\Api\Tests;

use Komato\Api\Config\RuleSet;

/**
 * End-to-end tests for the run lifecycle, through the real HTTP stack.
 *
 * These are the tests that pin the anti-cheat promise: a client cannot put a number
 * on the leaderboard just by sending one.
 */
final class RunApiTest extends TestCase
{
    public function testCreateRunIssuesAServerSideSeedAndExpiry(): void
    {
        $response = $this->request('POST', '/api/runs');
        $body = $this->json($response);

        self::assertSame(201, $response->getStatusCode());
        self::assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $body['runId']);
        self::assertIsInt($body['seed']);
        self::assertGreaterThanOrEqual(0, $body['seed']);
        self::assertLessThanOrEqual(0xFFFFFFFF, $body['seed']);
        self::assertSame(RuleSet::CURRENT_VERSION, $body['configVersion']);
        self::assertNotEmpty($body['expiresAt']);
    }

    public function testTwoRunsGetDifferentIdsAndSeeds(): void
    {
        $first = $this->json($this->request('POST', '/api/runs'));
        $second = $this->json($this->request('POST', '/api/runs'));

        self::assertNotSame($first['runId'], $second['runId']);
        // A collision here would be a 1-in-4-billion fluke; a repeat means the seed
        // is not actually random, which would let players pre-scout a layout.
        self::assertNotSame($first['seed'], $second['seed']);
    }

    public function testCompleteRunStoresTheServerComputedTotal(): void
    {
        $runId = $this->openRun();
        $stages = $this->validStages();

        $response = $this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'テスト太郎',
            'stages' => $stages,
            // A blatant lie. It must have no effect whatsoever.
            'totalScore' => 999999999,
        ]);
        $body = $this->json($response);

        $expected = array_sum(array_map(
            fn (array $stage): int => $this->calculator()->stageScore($stage['stageId'], $stage['metrics']),
            $stages,
        ));

        self::assertSame(200, $response->getStatusCode());
        self::assertTrue($body['accepted']);
        self::assertSame($expected, $body['totalScore']);
        self::assertSame(1, $body['rank']);
    }

    public function testTamperedScoreIsIgnoredAndTheHonestTotalIsUsed(): void
    {
        $runId = $this->openRun();
        $stages = $this->validStages();
        // The DevTools attack: inflate every reported score, leave the metrics alone.
        foreach ($stages as $index => $stage) {
            $stages[$index]['score'] = 1_000_000;
        }

        $body = $this->json($this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'cheater',
            'stages' => $stages,
            'totalScore' => 3_000_000,
        ]));

        // Three mismatches weigh 25 each, which crosses the rejection threshold.
        self::assertFalse($body['accepted']);
        self::assertLessThan(30_000, $body['totalScore']);
        self::assertNull($body['rank']);

        // Nothing reaches the public board.
        $board = $this->json($this->request('GET', '/api/leaderboard?period=all'));
        self::assertSame([], $board['entries']);
    }

    public function testImpossibleMetricsAreRejected(): void
    {
        $runId = $this->openRun();
        $stages = $this->validStages();
        // 5000 near misses in 24 seconds is not physically possible.
        $stages[0]['metrics']['nearMissCount'] = 5000;
        $stages[0]['score'] = $this->calculator()->stageScore('late', $stages[0]['metrics']);

        $body = $this->json($this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'cheater',
            'stages' => $stages,
            'totalScore' => 0,
        ]));

        self::assertFalse($body['accepted']);
    }

    public function testComboUnitsCannotExceedWhatTheHitCountAllows(): void
    {
        $runId = $this->openRun();
        $stages = $this->validStages();
        // 14 near misses can produce at most 14 * 9 combo units.
        $stages[0]['metrics']['comboUnits'] = 9999;
        $stages[0]['score'] = $this->calculator()->stageScore('late', $stages[0]['metrics']);

        $body = $this->json($this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'cheater',
            'stages' => $stages,
            'totalScore' => 0,
        ]));

        self::assertFalse($body['accepted']);
    }

    public function testImpossiblyFastStageIsRejected(): void
    {
        $runId = $this->openRun();
        $stages = $this->validStages();
        $stages[0]['durationMs'] = 50;

        $body = $this->json($this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'speedhack',
            'stages' => $stages,
            'totalScore' => 0,
        ]));

        self::assertFalse($body['accepted']);
    }

    public function testDuplicateSubmissionIsRejected(): void
    {
        $runId = $this->openRun();
        $payload = ['nickname' => 'テスト', 'stages' => $this->validStages(), 'totalScore' => 0];

        $first = $this->request('POST', "/api/runs/{$runId}/complete", $payload);
        self::assertSame(200, $first->getStatusCode());

        $second = $this->request('POST', "/api/runs/{$runId}/complete", $payload);
        self::assertSame(409, $second->getStatusCode());
        self::assertSame('run_already_completed', $this->json($second)['error']['code']);

        // And the board still holds exactly one entry.
        $board = $this->json($this->request('GET', '/api/leaderboard?period=all'));
        self::assertCount(1, $board['entries']);
    }

    public function testExpiredRunIsRejected(): void
    {
        $runId = $this->openRun();
        $this->clock->advance('+2 hours'); // run TTL is 30 minutes

        $response = $this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'テスト',
            'stages' => $this->validStages(),
            'totalScore' => 0,
        ]);

        self::assertSame(410, $response->getStatusCode());
        self::assertSame('run_expired', $this->json($response)['error']['code']);
    }

    public function testUnknownRunIsRejected(): void
    {
        $response = $this->request('POST', '/api/runs/00000000-0000-4000-8000-000000000000/complete', [
            'nickname' => 'テスト',
            'stages' => $this->validStages(),
            'totalScore' => 0,
        ]);

        self::assertSame(404, $response->getStatusCode());
        self::assertSame('unknown_run', $this->json($response)['error']['code']);
    }

    public function testMalformedRunIdIsRejectedBeforeTouchingTheDatabase(): void
    {
        $response = $this->request('POST', "/api/runs/' OR 1=1--/complete", [
            'nickname' => 'テスト',
            'stages' => $this->validStages(),
            'totalScore' => 0,
        ]);

        self::assertContains($response->getStatusCode(), [400, 404]);
    }

    public function testDuplicateStageInOneSubmissionIsRejected(): void
    {
        $runId = $this->openRun();
        $stages = $this->validStages();
        $stages[] = $stages[0]; // submit `late` twice

        $body = $this->json($this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'テスト',
            'stages' => $stages,
            'totalScore' => 0,
        ]));

        self::assertFalse($body['accepted']);
    }

    public function testEmptySubmissionIsRejected(): void
    {
        $runId = $this->openRun();

        $body = $this->json($this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'テスト',
            'stages' => [],
            'totalScore' => 0,
        ]));

        self::assertFalse($body['accepted']);
    }

    public function testNonNumericMetricIsRejectedAsUnprocessable(): void
    {
        $runId = $this->openRun();
        $stages = $this->validStages();
        $stages[0]['metrics']['nearMissCount'] = 'lots';

        $response = $this->request('POST', "/api/runs/{$runId}/complete", [
            'nickname' => 'テスト',
            'stages' => $stages,
            'totalScore' => 0,
        ]);

        self::assertSame(422, $response->getStatusCode());
    }

    public function testMalformedJsonIsRejected(): void
    {
        $request = (new \Slim\Psr7\Factory\ServerRequestFactory())
            ->createServerRequest('POST', '/api/runs')
            ->withHeader('Content-Type', 'application/json');
        $request->getBody()->write('{not json');
        $request->getBody()->rewind();

        $response = $this->app->handle($request);

        self::assertSame(400, $response->getStatusCode());
        self::assertSame('invalid_json', $this->json($response)['error']['code']);
    }

    public function testHealthEndpointReportsTheConfigVersion(): void
    {
        $response = $this->request('GET', '/api/health');
        $body = $this->json($response);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('ok', $body['status']);
        self::assertSame(RuleSet::CURRENT_VERSION, $body['configVersion']);
    }

    public function testUnknownEndpointReturnsJsonNotHtml(): void
    {
        $response = $this->request('GET', '/api/nope');

        self::assertSame(404, $response->getStatusCode());
        self::assertStringStartsWith('application/json', $response->getHeaderLine('Content-Type'));
    }

    public function testResponsesCarrySecurityHeaders(): void
    {
        $response = $this->request('GET', '/api/health');

        self::assertSame('nosniff', $response->getHeaderLine('X-Content-Type-Options'));
        self::assertSame('DENY', $response->getHeaderLine('X-Frame-Options'));
    }
}
