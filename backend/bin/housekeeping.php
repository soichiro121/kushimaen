<?php

declare(strict_types=1);

/**
 * Periodic cleanup. Run from cron, e.g. hourly:
 *
 *   0 * * * * php /var/www/komato-game/backend/bin/housekeeping.php
 *
 * Removes abandoned runs and stale rate-limit windows so the tables stay small.
 * Completed runs and scores are never touched - those are the leaderboard.
 */

use Komato\Api\Config\Database;
use Komato\Api\Config\Env;
use Komato\Api\Repository\RateLimitRepository;
use Komato\Api\Repository\RunRepository;
use Komato\Api\Support\SystemClock;

require dirname(__DIR__) . '/vendor/autoload.php';

Env::bootstrap();

try {
    $pdo = Database::connection();
    $now = (new SystemClock())->now();

    // Grace period so a run that is merely slow to finish is never deleted.
    $runs = (new RunRepository($pdo))->deleteExpiredBefore($now->modify('-1 day'));
    $buckets = (new RateLimitRepository($pdo))->purgeBefore($now->modify('-1 hour'));

    fwrite(STDOUT, "Removed {$runs} abandoned run(s) and {$buckets} rate-limit window(s).\n");
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Housekeeping failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
