<?php

declare(strict_types=1);

namespace Komato\Api\Support;

use DateTimeImmutable;

/** Test double: time only moves when the test moves it. */
final class FrozenClock implements Clock
{
    public function __construct(private DateTimeImmutable $now)
    {
    }

    public function now(): DateTimeImmutable
    {
        return $this->now;
    }

    public function advance(string $interval): void
    {
        $this->now = $this->now->modify($interval);
    }

    public function set(DateTimeImmutable $now): void
    {
        $this->now = $now;
    }
}
