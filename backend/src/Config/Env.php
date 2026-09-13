<?php

declare(strict_types=1);

namespace Komato\Api\Config;

use Dotenv\Dotenv;
use RuntimeException;

/**
 * Environment access.
 *
 * Secrets (database password, CORS origins) live in `backend/.env`, which is NOT in
 * version control. `.env.example` documents every key.
 */
final class Env
{
    private static bool $loaded = false;

    public static function bootstrap(?string $directory = null): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;

        $directory ??= dirname(__DIR__, 2);
        if (is_readable($directory . '/.env')) {
            // Immutable: never overwrite a value already set by Apache/SetEnv, which
            // is the safer way to configure secrets on a shared host.
            Dotenv::createImmutable($directory)->safeLoad();
        }
    }

    public static function get(string $key, ?string $default = null): string
    {
        self::bootstrap();
        $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);
        if ($value === false || $value === null || $value === '') {
            if ($default === null) {
                throw new RuntimeException("Required environment variable {$key} is not set");
            }
            return $default;
        }
        return (string) $value;
    }

    public static function getOptional(string $key): ?string
    {
        self::bootstrap();
        $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);
        return ($value === false || $value === null || $value === '') ? null : (string) $value;
    }

    public static function int(string $key, int $default): int
    {
        $value = self::getOptional($key);
        return $value === null ? $default : (int) $value;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $value = self::getOptional($key);
        if ($value === null) {
            return $default;
        }
        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }

    /** @return list<string> */
    public static function list(string $key): array
    {
        $value = self::getOptional($key);
        if ($value === null) {
            return [];
        }
        return array_values(array_filter(array_map('trim', explode(',', $value))));
    }

    public static function isProduction(): bool
    {
        return self::get('APP_ENV', 'production') === 'production';
    }
}
