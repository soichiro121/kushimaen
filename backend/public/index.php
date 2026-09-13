<?php

declare(strict_types=1);

/**
 * Front controller.
 *
 * This is the ONLY file under the document root that PHP executes. `src/`, `vendor/`,
 * `migrations/` and `.env` all live one level up so they are unreachable over HTTP -
 * see docs/DEPLOYMENT.md for the Apache configuration that enforces it.
 */

use Komato\Api\AppFactory;

require dirname(__DIR__) . '/vendor/autoload.php';

// Errors are reported through the JSON error middleware, never printed into a
// response body where they could leak paths or query fragments.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

AppFactory::create()->run();
