<?php

declare(strict_types=1);

namespace Komato\Api\Repository;

use DateTimeImmutable;
use DateTimeZone;
use PDO;

/**
 * Leaderboard persistence and ranking.
 *
 * Only entries with `valid = 1` are ever shown. Suspicious submissions are still
 * stored (with `valid = 0` and their suspicion score) so that abuse can be reviewed
 * later rather than vanishing silently.
 */
final class ScoreRepository
{
    private const TIMESTAMP_FORMAT = 'Y-m-d H:i:s';

    /**
     * @param int $configVersion only scores played under this rule set are ranked.
     *        Balance changes make totals incomparable, so each generation gets its
     *        own board rather than old inflated scores sitting on top forever.
     */
    public function __construct(
        private readonly PDO $pdo,
        private readonly int $configVersion,
    ) {
    }

    public function insert(
        string $runId,
        string $nickname,
        int $totalScore,
        DateTimeImmutable $createdAt,
        bool $valid,
        int $suspicionScore,
        int $configVersion,
    ): void {
        $statement = $this->pdo->prepare(
            'INSERT INTO scores
                (run_id, nickname, total_score, created_at, valid, suspicion_score, config_version)
             VALUES
                (:run_id, :nickname, :total_score, :created_at, :valid, :suspicion_score, :config_version)'
        );
        $statement->execute([
            ':run_id' => $runId,
            ':nickname' => $nickname,
            ':total_score' => $totalScore,
            ':created_at' => $this->format($createdAt),
            ':valid' => $valid ? 1 : 0,
            ':suspicion_score' => $suspicionScore,
            ':config_version' => $configVersion,
        ]);
    }

    /**
     * Top entries for a period.
     *
     * Ties are broken by the earlier submission, so a rank never changes underneath a
     * player who is already on the board.
     *
     * @return list<array{rank: int, runId: string, nickname: string, totalScore: int, createdAt: string}>
     */
    public function top(string $period, int $limit, DateTimeImmutable $now): array
    {
        [$where, $params] = $this->periodFilter($period, $now);
        $params[':version'] = $this->configVersion;
        $limit = max(1, min($limit, 200));

        $statement = $this->pdo->prepare(
            "SELECT run_id, nickname, total_score, created_at
             FROM scores
             WHERE valid = 1 AND config_version = :version {$where}
             ORDER BY total_score DESC, created_at ASC
             LIMIT {$limit}"
        );
        $statement->execute($params);

        $entries = [];
        $rank = 0;
        foreach ($statement->fetchAll() as $row) {
            $rank++;
            $entries[] = [
                'rank' => $rank,
                'runId' => (string) $row['run_id'],
                'nickname' => (string) $row['nickname'],
                'totalScore' => (int) $row['total_score'],
                'createdAt' => $this->toIso((string) $row['created_at']),
            ];
        }
        return $entries;
    }

    /**
     * One run's placement, even when it is outside the returned page.
     *
     * @return array{rank: int, runId: string, nickname: string, totalScore: int, createdAt: string}|null
     */
    public function placementOf(string $runId, string $period, DateTimeImmutable $now): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT run_id, nickname, total_score, created_at FROM scores
             WHERE run_id = :run_id AND valid = 1'
        );
        $statement->execute([':run_id' => $runId]);
        $row = $statement->fetch();
        if ($row === false) {
            return null;
        }

        [$where, $params] = $this->periodFilter($period, $now);
        $params[':version'] = $this->configVersion;
        $params[':score'] = (int) $row['total_score'];
        $params[':created_at'] = (string) $row['created_at'];

        // Rank = (how many entries beat it) + 1, with the same tie-break as `top()`.
        $rankStatement = $this->pdo->prepare(
            "SELECT COUNT(*) AS ahead FROM scores
             WHERE valid = 1 AND config_version = :version {$where}
               AND (total_score > :score OR (total_score = :score AND created_at < :created_at))"
        );
        $rankStatement->execute($params);
        $ahead = (int) ($rankStatement->fetch()['ahead'] ?? 0);

        return [
            'rank' => $ahead + 1,
            'runId' => (string) $row['run_id'],
            'nickname' => (string) $row['nickname'],
            'totalScore' => (int) $row['total_score'],
            'createdAt' => $this->toIso((string) $row['created_at']),
        ];
    }

    public function countValid(string $period, DateTimeImmutable $now): int
    {
        [$where, $params] = $this->periodFilter($period, $now);
        $params[':version'] = $this->configVersion;
        $statement = $this->pdo->prepare(
            "SELECT COUNT(*) AS total FROM scores
             WHERE valid = 1 AND config_version = :version {$where}"
        );
        $statement->execute($params);

        return (int) ($statement->fetch()['total'] ?? 0);
    }

    public function existsForRun(string $runId): bool
    {
        $statement = $this->pdo->prepare('SELECT 1 FROM scores WHERE run_id = :run_id');
        $statement->execute([':run_id' => $runId]);

        return $statement->fetch() !== false;
    }

    /**
     * Builds the period predicate. The SQL fragment contains no user input - only a
     * fixed string and a bound parameter.
     *
     * @return array{0: string, 1: array<string, string>}
     */
    private function periodFilter(string $period, DateTimeImmutable $now): array
    {
        if ($period !== 'today') {
            return ['', []];
        }
        // "Today" is the operator's local day (the school day), not UTC midnight.
        $timezone = new DateTimeZone(\Komato\Api\Config\Env::get('APP_TIMEZONE', 'Asia/Tokyo'));
        $startOfDay = $now->setTimezone($timezone)->setTime(0, 0)->setTimezone(new DateTimeZone('UTC'));

        return [' AND created_at >= :since', [':since' => $startOfDay->format(self::TIMESTAMP_FORMAT)]];
    }

    private function format(DateTimeImmutable $value): string
    {
        return $value->setTimezone(new DateTimeZone('UTC'))->format(self::TIMESTAMP_FORMAT);
    }

    private function toIso(string $stored): string
    {
        $parsed = DateTimeImmutable::createFromFormat(
            self::TIMESTAMP_FORMAT,
            substr($stored, 0, 19),
            new DateTimeZone('UTC')
        );
        return ($parsed ?: new DateTimeImmutable($stored))->format(DATE_ATOM);
    }
}
