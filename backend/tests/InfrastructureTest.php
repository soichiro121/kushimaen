<?php

declare(strict_types=1);

namespace Komato\Api\Tests;

use DateTimeImmutable;
use DateTimeZone;
use Komato\Api\Config\Database;
use Komato\Api\Repository\RateLimitRepository;
use Komato\Api\Repository\RunRepository;
use Komato\Api\Support\Migrator;
use PHPUnit\Framework\TestCase as BaseTestCase;

/**
 * Migrations, rate limiting and housekeeping.
 *
 * These are the parts that only show up in production - a schema that cannot be
 * rebuilt, a limiter that does not limit, tables that grow forever - so they get
 * tests even though no player ever sees them.
 */
final class InfrastructureTest extends BaseTestCase
{
    public function testDatabaseCanBeRebuiltFromZero(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        $migrator = new Migrator($pdo, dirname(__DIR__) . '/migrations');

        $applied = $migrator->migrate();
        self::assertNotEmpty($applied, 'no migrations were applied');

        $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll();
        $names = array_column($tables, 'name');

        foreach (['runs', 'scores', 'stage_results', 'rate_limits', 'migrations'] as $table) {
            self::assertContains($table, $names, "table {$table} is missing");
        }
    }

    public function testMigratingTwiceIsANoOp(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        $migrator = new Migrator($pdo, dirname(__DIR__) . '/migrations');

        $first = $migrator->migrate();
        $second = $migrator->migrate();

        self::assertNotEmpty($first);
        self::assertSame([], $second);
    }

    public function testOneRunCanOnlyHaveOneScoreRow(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        (new Migrator($pdo, dirname(__DIR__) . '/migrations'))->migrate();

        $pdo->exec(
            "INSERT INTO runs (id, seed, config_version, started_at, expires_at, status)
             VALUES ('r1', 1, 1, '2026-01-01 00:00:00', '2026-01-01 01:00:00', 'open')"
        );
        $insert = "INSERT INTO scores (run_id, nickname, total_score, created_at, valid, suspicion_score)
                   VALUES ('r1', 'a', 10, '2026-01-01 00:30:00', 1, 0)";
        $pdo->exec($insert);

        // The unique constraint is the last line of defence behind the application
        // check, in case two requests ever race past it.
        $this->expectException(\PDOException::class);
        $pdo->exec($insert);
    }

    public function testRateLimiterAllowsUpToTheLimitThenBlocks(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        (new Migrator($pdo, dirname(__DIR__) . '/migrations'))->migrate();
        $repository = new RateLimitRepository($pdo);
        $now = new DateTimeImmutable('2026-05-01 09:00:00', new DateTimeZone('UTC'));

        for ($i = 0; $i < 3; $i++) {
            self::assertTrue($repository->hit('1.2.3.4|/api/runs', 3, 60, $now)['allowed']);
        }
        $blocked = $repository->hit('1.2.3.4|/api/runs', 3, 60, $now);

        self::assertFalse($blocked['allowed']);
        self::assertGreaterThan(0, $blocked['retryAfter']);
    }

    public function testRateLimitBucketsAreIndependentPerClient(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        (new Migrator($pdo, dirname(__DIR__) . '/migrations'))->migrate();
        $repository = new RateLimitRepository($pdo);
        $now = new DateTimeImmutable('2026-05-01 09:00:00', new DateTimeZone('UTC'));

        $repository->hit('a|/api/runs', 1, 60, $now);
        $repository->hit('a|/api/runs', 1, 60, $now);

        self::assertFalse($repository->hit('a|/api/runs', 1, 60, $now)['allowed']);
        self::assertTrue($repository->hit('b|/api/runs', 1, 60, $now)['allowed']);
    }

    public function testRateLimitResetsInTheNextWindow(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        (new Migrator($pdo, dirname(__DIR__) . '/migrations'))->migrate();
        $repository = new RateLimitRepository($pdo);
        $now = new DateTimeImmutable('2026-05-01 09:00:00', new DateTimeZone('UTC'));

        $repository->hit('c|/api/runs', 1, 60, $now);
        self::assertFalse($repository->hit('c|/api/runs', 1, 60, $now)['allowed']);

        self::assertTrue($repository->hit('c|/api/runs', 1, 60, $now->modify('+61 seconds'))['allowed']);
    }

    public function testRawIpAddressesAreNotStored(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        (new Migrator($pdo, dirname(__DIR__) . '/migrations'))->migrate();

        (new RateLimitRepository($pdo))->hit(
            '203.0.113.42|/api/runs',
            10,
            60,
            new DateTimeImmutable('2026-05-01 09:00:00', new DateTimeZone('UTC')),
        );

        $buckets = $pdo->query('SELECT bucket FROM rate_limits')->fetchAll();
        foreach ($buckets as $row) {
            self::assertStringNotContainsString('203.0.113.42', (string) $row['bucket']);
            self::assertSame(64, strlen((string) $row['bucket']), 'bucket should be a sha256 hex digest');
        }
    }

    public function testHousekeepingRemovesAbandonedRunsButKeepsCompletedOnes(): void
    {
        $pdo = Database::connect('sqlite::memory:');
        (new Migrator($pdo, dirname(__DIR__) . '/migrations'))->migrate();

        $pdo->exec(
            "INSERT INTO runs (id, seed, config_version, started_at, expires_at, completed_at, status) VALUES
             ('abandoned', 1, 1, '2026-01-01 00:00:00', '2026-01-01 00:30:00', NULL, 'open'),
             ('finished',  2, 1, '2026-01-01 00:00:00', '2026-01-01 00:30:00', '2026-01-01 00:10:00', 'completed')"
        );

        $removed = (new RunRepository($pdo))
            ->deleteExpiredBefore(new DateTimeImmutable('2026-02-01 00:00:00', new DateTimeZone('UTC')));

        self::assertSame(1, $removed);
        $remaining = $pdo->query('SELECT id FROM runs')->fetchAll();
        self::assertSame(['finished'], array_column($remaining, 'id'));
    }
}
