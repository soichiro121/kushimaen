<?php

declare(strict_types=1);

namespace Komato\Api\Domain;

/**
 * One reason a submission looks wrong.
 *
 * `weight` feeds the suspicion score (0-100). Individually fatal problems weigh 100;
 * things that are merely odd weigh less, so a single quirk does not reject an honest
 * player while a combination still does.
 */
final class ValidationIssue
{
    public function __construct(
        public readonly string $code,
        public readonly string $message,
        public readonly int $weight,
    ) {
    }

    /** @return array{code: string, message: string, weight: int} */
    public function toArray(): array
    {
        return ['code' => $this->code, 'message' => $this->message, 'weight' => $this->weight];
    }
}
