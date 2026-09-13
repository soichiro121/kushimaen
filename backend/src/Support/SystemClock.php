<?php

declare(strict_types=1);

namespace Komato\Api\Support;

use DateTimeImmutable;
use DateTimeZone;

/** The real clock. Always UTC: the database stores UTC and converts on display. */
final class SystemClock implements Clock
{
    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }
}
