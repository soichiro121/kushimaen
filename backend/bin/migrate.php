<?php

declare(strict_types=1);

/**
 * Applies pending database migrations.
 *
 *   php bin/migrate.php
 *
 * Safe to re-run: already-applied files are skipped. Reads DB_DSN / DB_USER /
 * DB_PASSWORD from backend/.env.
 */

use Komato\Api\Config\Database;
use Komato\Api\Config\Env;
use Komato\Api\Support\Migrator;

require dirname(__DIR__) . '/vendor/autoload.php';

Env::bootstrap();

try {
    $pdo = Database::connection();
    $migrator = new Migrator($pdo, dirname(__DIR__) . '/migrations');

    fwrite(STDOUT, "Migrations directory: {$migrator->directory()}\n");
    $applied = $migrator->migrate();

    if ($applied === []) {
        fwrite(STDOUT, "Database is already up to date.\n");
    } else {
        foreach ($applied as $name) {
            fwrite(STDOUT, "  applied {$name}\n");
        }
        fwrite(STDOUT, 'Applied ' . count($applied) . " migration(s).\n");
    }
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Migration failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
