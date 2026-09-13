<?php

declare(strict_types=1);

namespace Komato\Api\Config;

use PDO;
use PDOException;
use RuntimeException;

/**
 * PDO connection factory.
 *
 * The schema and every query are written to work on MySQL/MariaDB, PostgreSQL and
 * SQLite, so the deployment is not tied to one database. SQLite is what the test
 * suite uses, which keeps `composer test` dependency-free.
 *
 * Only ever used with prepared statements - no user value is ever concatenated into
 * SQL anywhere in this project.
 */
final class Database
{
    private static ?PDO $connection = null;

    public static function connection(): PDO
    {
        return self::$connection ??= self::connect(
            Env::get('DB_DSN'),
            Env::getOptional('DB_USER'),
            Env::getOptional('DB_PASSWORD'),
        );
    }

    /** Injects a connection (tests, migrations against a temporary database). */
    public static function setConnection(?PDO $connection): void
    {
        self::$connection = $connection;
    }

    public static function connect(string $dsn, ?string $user = null, ?string $password = null): PDO
    {
        try {
            $pdo = new PDO($dsn, $user, $password, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Real prepared statements, so the driver - not string interpolation -
                // separates SQL from data.
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ]);
        } catch (PDOException $exception) {
            // The DSN can contain a host name; never let it reach the client.
            throw new RuntimeException('Database connection failed', 0, $exception);
        }

        $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            // Off by default in SQLite, and the schema relies on them.
            $pdo->exec('PRAGMA foreign_keys = ON');
            // Far better concurrent read behaviour under Apache's process model.
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 4000');
        } elseif ($driver === 'mysql') {
            $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
            $pdo->exec("SET time_zone = '+00:00'");
        } elseif ($driver === 'pgsql') {
            $pdo->exec("SET TIME ZONE 'UTC'");
        }

        return $pdo;
    }

    public static function driver(?PDO $pdo = null): string
    {
        return (string) ($pdo ?? self::connection())->getAttribute(PDO::ATTR_DRIVER_NAME);
    }
}
