<?php

declare(strict_types=1);

namespace Komato\Api\Support;

use PDO;
use RuntimeException;

/**
 * SQL migration runner.
 *
 * Production databases are never changed by hand: every schema change is a new
 * numbered file under `backend/migrations/<driver>/`, and the database can always be
 * rebuilt from zero by running them in order.
 *
 * Applied migrations are recorded in a `migrations` table, so re-running is a no-op.
 */
final class Migrator
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly string $migrationsRoot,
    ) {
    }

    /**
     * Applies everything not yet recorded.
     *
     * @return list<string> the names applied by this call
     */
    public function migrate(): array
    {
        $this->ensureLedger();
        $applied = $this->appliedNames();
        $done = [];

        foreach ($this->pendingFiles($applied) as $name => $file) {
            $sql = file_get_contents($file);
            if ($sql === false) {
                throw new RuntimeException("Could not read migration {$file}");
            }

            // One transaction per migration where the driver supports DDL rollback.
            // MySQL commits DDL implicitly; the ledger row still tells us where we got to.
            $this->pdo->beginTransaction();
            try {
                foreach ($this->statements($sql) as $statement) {
                    $this->pdo->exec($statement);
                }
                $record = $this->pdo->prepare(
                    'INSERT INTO migrations (name, applied_at) VALUES (:name, :applied_at)'
                );
                $record->execute([
                    ':name' => $name,
                    ':applied_at' => gmdate('Y-m-d H:i:s'),
                ]);
                $this->pdo->commit();
            } catch (\Throwable $exception) {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->rollBack();
                }
                throw new RuntimeException("Migration {$name} failed: " . $exception->getMessage(), 0, $exception);
            }

            $done[] = $name;
        }

        return $done;
    }

    public function directory(): string
    {
        $driver = (string) $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $directory = rtrim($this->migrationsRoot, '/\\') . '/' . $driver;

        if (!is_dir($directory)) {
            throw new RuntimeException(
                "No migrations for driver \"{$driver}\". Expected {$directory}. "
                . 'Supported drivers: mysql, pgsql, sqlite.'
            );
        }
        return $directory;
    }

    private function ensureLedger(): void
    {
        $driver = (string) $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $timestampType = $driver === 'sqlite' ? 'TEXT' : ($driver === 'pgsql' ? 'TIMESTAMP' : 'DATETIME');
        $textType = $driver === 'sqlite' ? 'TEXT' : 'VARCHAR(191)';

        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS migrations (
                name {$textType} NOT NULL PRIMARY KEY,
                applied_at {$timestampType} NOT NULL
            )"
        );
    }

    /** @return list<string> */
    private function appliedNames(): array
    {
        $rows = $this->pdo->query('SELECT name FROM migrations')?->fetchAll() ?: [];

        return array_map(static fn (array $row): string => (string) $row['name'], $rows);
    }

    /**
     * @param list<string> $applied
     * @return array<string, string> name => absolute path, in filename order
     */
    private function pendingFiles(array $applied): array
    {
        $files = glob($this->directory() . '/*.sql') ?: [];
        sort($files, SORT_STRING);

        $pending = [];
        foreach ($files as $file) {
            $name = basename($file);
            if (!in_array($name, $applied, true)) {
                $pending[$name] = $file;
            }
        }
        return $pending;
    }

    /**
     * Splits a file into statements.
     *
     * Deliberately simple: the migrations in this project are plain DDL with no
     * stored routines, so splitting on `;` at the end of a line is sufficient and
     * avoids pulling in a SQL parser.
     *
     * @return list<string>
     */
    private function statements(string $sql): array
    {
        $withoutComments = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;

        return array_values(array_filter(
            array_map('trim', explode(';', $withoutComments)),
            static fn (string $statement): bool => $statement !== '',
        ));
    }
}
