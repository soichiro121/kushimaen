<?php

declare(strict_types=1);

namespace Komato\Api\Tests;

use DateTimeImmutable;
use DateTimeZone;
use Komato\Api\AppFactory;
use Komato\Api\Config\Database;
use Komato\Api\Config\RuleSet;
use Komato\Api\Service\ScoreCalculator;
use Komato\Api\Support\FrozenClock;
use Komato\Api\Support\Migrator;
use PDO;
use PHPUnit\Framework\TestCase as BaseTestCase;
use Psr\Http\Message\ResponseInterface;
use Slim\App;
use Slim\Psr7\Factory\ServerRequestFactory;

/**
 * Shared test scaffolding.
 *
 * Every test runs against a real, freshly migrated in-memory SQLite database and the
 * real middleware stack, so the tests exercise the same code path a request takes in
 * production - only the clock and the storage engine differ.
 */
abstract class TestCase extends BaseTestCase
{
    protected PDO $pdo;
    protected FrozenClock $clock;
    protected App $app;

    protected function setUp(): void
    {
        parent::setUp();

        $_ENV['APP_ENV'] = 'development';
        $_ENV['APP_TIMEZONE'] = 'Asia/Tokyo';
        $_ENV['LOG_FILE'] = sys_get_temp_dir() . '/komato-test.log';
        // Rate limiting is exercised by its own test; elsewhere it only adds noise.
        $_ENV['RATE_LIMIT_PER_WINDOW'] = '10000';

        $this->pdo = Database::connect('sqlite::memory:');
        Database::setConnection($this->pdo);
        (new Migrator($this->pdo, dirname(__DIR__) . '/migrations'))->migrate();

        $this->clock = new FrozenClock(new DateTimeImmutable('2026-05-01 09:00:00', new DateTimeZone('UTC')));
        $this->app = AppFactory::create($this->pdo, $this->clock);
    }

    protected function tearDown(): void
    {
        Database::setConnection(null);
        parent::tearDown();
    }

    protected function rules(): RuleSet
    {
        return RuleSet::load();
    }

    protected function calculator(): ScoreCalculator
    {
        return new ScoreCalculator($this->rules());
    }

    /** @param array<string, mixed>|null $body */
    protected function request(string $method, string $path, ?array $body = null): ResponseInterface
    {
        $request = (new ServerRequestFactory())->createServerRequest($method, $path);
        $request = $request->withHeader('Content-Type', 'application/json');

        if ($body !== null) {
            $request->getBody()->write(json_encode($body, JSON_THROW_ON_ERROR));
            $request->getBody()->rewind();
        }

        return $this->app->handle($request);
    }

    /** @return array<string, mixed> */
    protected function json(ResponseInterface $response): array
    {
        $response->getBody()->rewind();
        /** @var array<string, mixed> $decoded */
        $decoded = json_decode((string) $response->getBody()->getContents(), true, 32, JSON_THROW_ON_ERROR);

        return $decoded;
    }

    /**
     * A clean, self-consistent submission: every score matches what the server will
     * recompute, so these stages are accepted unless a test deliberately breaks one.
     *
     * @return list<array{stageId: string, score: int, durationMs: int, metrics: array<string, int>}>
     */
    protected function validStages(): array
    {
        $calculator = $this->calculator();

        $late = [
            'nearMissCount' => 14,
            'comboUnits' => 18,
            'collisionCount' => 1,
            'maxCombo' => 5,
            'goalReached' => 1,
            'timeRemainingSec' => 6,
        ];
        $bread = [
            'questionCount' => 8,
            'correctCount' => 7,
            'mistakeCount' => 1,
            'speedUnits' => 30,
            'comboUnits' => 12,
            'maxCombo' => 5,
            'totalReactionMs' => 9800,
        ];
        $teacher = [
            'cleared' => 1,
            'checkpointsCompleted' => 3,
            'timeRemainingSec' => 41,
            'caughtCount' => 1,
            'detectionCount' => 2,
            'dangerPassCount' => 2,
            'perfectStealth' => 0,
            'routeDistance' => 9200,
            'idleTimeMs' => 4200,
        ];

        return [
            [
                'stageId' => 'late',
                'score' => $calculator->stageScore('late', $late),
                'durationMs' => 24000,
                'metrics' => $late,
            ],
            [
                'stageId' => 'bread',
                'score' => $calculator->stageScore('bread', $bread),
                'durationMs' => 22000,
                'metrics' => $bread,
            ],
            [
                'stageId' => 'teacher',
                'score' => $calculator->stageScore('teacher', $teacher),
                'durationMs' => 49000,
                'metrics' => $teacher,
            ],
        ];
    }

    /** Opens a run through the API and returns its id. */
    protected function openRun(): string
    {
        $response = $this->request('POST', '/api/runs');
        self::assertSame(201, $response->getStatusCode());

        return (string) $this->json($response)['runId'];
    }
}
