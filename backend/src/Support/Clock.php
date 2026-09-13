<?php

declare(strict_types=1);

namespace Komato\Api\Support;

use DateTimeImmutable;

/**
 * Injectable clock.
 *
 * Run expiry and the "today" leaderboard both depend on the current time, and both
 * need to be testable without sleeping, so time is never read directly from `time()`
 * inside the services.
 */
interface Clock
{
    public function now(): DateTimeImmutable;
}
