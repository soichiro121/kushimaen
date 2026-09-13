<?php

declare(strict_types=1);

namespace Komato\Api\Domain;

/** The result of validating a whole submission. */
final class ValidationOutcome
{
    /**
     * @param array<string, int>    $stageScores server-recomputed, keyed by stage id
     * @param list<ValidationIssue> $issues
     */
    public function __construct(
        public readonly bool $valid,
        public readonly int $totalScore,
        public readonly array $stageScores,
        public readonly array $issues,
        public readonly int $suspicionScore,
    ) {
    }

    public function firstMessage(): ?string
    {
        return $this->issues[0]->message ?? null;
    }

    /** @return list<array{code: string, message: string, weight: int}> */
    public function issuesToArray(): array
    {
        return array_map(static fn (ValidationIssue $issue): array => $issue->toArray(), $this->issues);
    }
}
