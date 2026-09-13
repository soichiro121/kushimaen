<?php

declare(strict_types=1);

namespace Komato\Api\Repository;

use DateTimeImmutable;
use DateTimeZone;
use Komato\Api\Domain\Run;
use PDO;

/**
 * Persistence for runs.
 *
 * Every statement is prepared and every value is bound - there is no string
 * interpolation of user input anywhere in this class.
 *
 * Timestamps are stored as UTC strings in a portable `Y-m-d H:i:s` format so the same
 * SQL works on MySQL, PostgreSQL and SQLite.
 */
final class RunRepository
{
    public const TIMESTAMP_FORMAT = 'Y-m-d H:i:s';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function insert(Run $run): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO runs (id, seed, config_version, started_at, expires_at, completed_at, status)
             VALUES (:id, :seed, :config_version, :started_at, :expires_at, NULL, :status)'
        );
        $statement->execute([
            ':id' => $run->id,
            ':seed' => $run->seed,
            ':config_version' => $run->configVersion,
            ':started_at' => $this->format($run->startedAt),
            ':expires_at' => $this->format($run->expiresAt),
            ':status' => $run->status,
        ]);
    }

    public function find(string $runId): ?Run
    {
        $statement = $this->pdo->prepare(
            'SELECT id, seed, config_version, started_at, expires_at, completed_at, status
             FROM runs WHERE id = :id'
        );
        $statement->execute([':id' => $runId]);
        $row = $statement->fetch();

        return $row === false ? null : $this->hydrate($row);
    }

    /**
     * Closes a run. The `status = 'open'` predicate is what makes a duplicate submit
     * impossible: the second request updates zero rows and is rejected, even if two
     * requests arrive at the same instant.
     */
    public function markCompleted(string $runId, DateTimeImmutable $completedAt, string $status): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE runs
             SET completed_at = :completed_at, status = :status
             WHERE id = :id AND status = :open'
        );
        $statement->execute([
            ':completed_at' => $this->format($completedAt),
            ':status' => $status,
            ':id' => $runId,
            ':open' => Run::STATUS_OPEN,
        ]);

        return $statement->rowCount() === 1;
    }

    /** Housekeeping: drops abandoned runs so the table does not grow without bound. */
    public function deleteExpiredBefore(DateTimeImmutable $cutoff): int
    {
        $statement = $this->pdo->prepare(
            'DELETE FROM runs WHERE status = :open AND expires_at < :cutoff'
        );
        $statement->execute([':open' => Run::STATUS_OPEN, ':cutoff' => $this->format($cutoff)]);

        return $statement->rowCount();
    }

    private function hydrate(array $row): Run
    {
        return new Run(
            (string) $row['id'],
            (int) $row['seed'],
            (int) $row['config_version'],
            $this->parse((string) $row['started_at']),
            $this->parse((string) $row['expires_at']),
            $row['completed_at'] === null ? null : $this->parse((string) $row['completed_at']),
            (string) $row['status'],
        );
    }

    private function format(DateTimeImmutable $value): string
    {
        return $value->setTimezone(new DateTimeZone('UTC'))->format(self::TIMESTAMP_FORMAT);
    }

    private function parse(string $value): DateTimeImmutable
    {
        // PostgreSQL returns microseconds; accept whatever the driver produced.
        $parsed = DateTimeImmutable::createFromFormat(
            self::TIMESTAMP_FORMAT,
            substr($value, 0, 19),
            new DateTimeZone('UTC')
        );
        return $parsed ?: new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }
}
