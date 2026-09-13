<?php

declare(strict_types=1);

namespace Komato\Api\Repository;

use DateTimeImmutable;
use DateTimeZone;
use PDO;

/**
 * Fixed-window rate limiting, stored in the database.
 *
 * Apache runs many worker processes, so an in-process counter would not actually
 * limit anything; the shared store is the database we already have. A fixed window
 * is coarse but adequate here - the goal is to stop a script hammering
 * `POST /api/runs`, not to police a precise request budget.
 */
final class RateLimitRepository
{
    private const TIMESTAMP_FORMAT = 'Y-m-d H:i:s';

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Records a hit and reports whether the caller is over the limit.
     *
     * @return array{allowed: bool, retryAfter: int}
     */
    public function hit(string $bucket, int $limit, int $windowSeconds, DateTimeImmutable $now): array
    {
        $windowStart = $this->windowStart($now, $windowSeconds);
        $key = hash('sha256', $bucket); // never store a raw IP address

        // UPSERT-free for portability: try to increment, insert when nothing matched.
        $update = $this->pdo->prepare(
            'UPDATE rate_limits SET hits = hits + 1
             WHERE bucket = :bucket AND window_start = :window_start'
        );
        $update->execute([':bucket' => $key, ':window_start' => $windowStart]);

        if ($update->rowCount() === 0) {
            $insert = $this->pdo->prepare(
                'INSERT INTO rate_limits (bucket, window_start, hits) VALUES (:bucket, :window_start, 1)'
            );
            try {
                $insert->execute([':bucket' => $key, ':window_start' => $windowStart]);
            } catch (\PDOException) {
                // Another worker inserted the same window first; count our hit on it.
                $update->execute([':bucket' => $key, ':window_start' => $windowStart]);
            }
        }

        $select = $this->pdo->prepare(
            'SELECT hits FROM rate_limits WHERE bucket = :bucket AND window_start = :window_start'
        );
        $select->execute([':bucket' => $key, ':window_start' => $windowStart]);
        $hits = (int) ($select->fetch()['hits'] ?? 0);

        $elapsed = $now->getTimestamp() % $windowSeconds;

        return [
            'allowed' => $hits <= $limit,
            'retryAfter' => max(1, $windowSeconds - $elapsed),
        ];
    }

    /** Housekeeping so the table cannot grow without bound. */
    public function purgeBefore(DateTimeImmutable $cutoff): int
    {
        $statement = $this->pdo->prepare('DELETE FROM rate_limits WHERE window_start < :cutoff');
        $statement->execute([
            ':cutoff' => $cutoff->setTimezone(new DateTimeZone('UTC'))->format(self::TIMESTAMP_FORMAT),
        ]);

        return $statement->rowCount();
    }

    private function windowStart(DateTimeImmutable $now, int $windowSeconds): string
    {
        $bucketed = $now->getTimestamp() - ($now->getTimestamp() % $windowSeconds);

        return (new DateTimeImmutable('@' . $bucketed))
            ->setTimezone(new DateTimeZone('UTC'))
            ->format(self::TIMESTAMP_FORMAT);
    }
}
