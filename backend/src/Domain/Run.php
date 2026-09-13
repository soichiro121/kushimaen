<?php

declare(strict_types=1);

namespace Komato\Api\Domain;

use DateTimeImmutable;

/**
 * A single attempt at the whole three-stage set.
 *
 * The server owns the id, the seed and the expiry, so a client cannot reroll for a
 * favourable seed, replay an old run, or submit twice.
 */
final class Run
{
    public const STATUS_OPEN = 'open';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_REJECTED = 'rejected';

    public function __construct(
        public readonly string $id,
        public readonly int $seed,
        public readonly int $configVersion,
        public readonly DateTimeImmutable $startedAt,
        public readonly DateTimeImmutable $expiresAt,
        public readonly ?DateTimeImmutable $completedAt,
        public readonly string $status,
    ) {
    }

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }

    public function isExpiredAt(DateTimeImmutable $now): bool
    {
        return $now > $this->expiresAt;
    }
}
