<?php

declare(strict_types=1);

/**
 * PHPUnit bootstrap.
 *
 * Tests run against in-memory SQLite, so no database server is required and
 * `composer test` works on a fresh checkout.
 */

require dirname(__DIR__) . '/vendor/autoload.php';

// Set before anything reads the environment: `Env` caches its first load.
$_ENV['APP_ENV'] = 'development';
$_ENV['DB_DSN'] = 'sqlite::memory:';
// Derived, never a literal: a hard-coded version here goes stale the moment the
// balance is rebalanced, and the whole suite then tests the previous generation.
$_ENV['CONFIG_VERSION'] = (string) Komato\Api\Config\RuleSet::CURRENT_VERSION;
