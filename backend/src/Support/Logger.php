<?php

declare(strict_types=1);

namespace Komato\Api\Support;

use Komato\Api\Config\Env;
use Throwable;

/**
 * Minimal file logger (JSON lines).
 *
 * Deliberately tiny: a full logging stack is not warranted at this size, but the
 * operator still needs a readable trail of rejected submissions and internal errors.
 *
 * Nothing written here is ever returned to a client.
 */
final class Logger
{
    public function __construct(
        private readonly string $file,
        private readonly Clock $clock = new SystemClock(),
    ) {
    }

    public static function default(): self
    {
        $path = Env::getOptional('LOG_FILE') ?? dirname(__DIR__, 2) . '/var/app.log';
        return new self($path);
    }

    public function info(string $message, array $context = []): void
    {
        $this->write('info', $message, $context);
    }

    public function warning(string $message, array $context = []): void
    {
        $this->write('warning', $message, $context);
    }

    public function error(string $message, array $context = []): void
    {
        $this->write('error', $message, $context);
    }

    public function exception(Throwable $exception, array $context = []): void
    {
        $this->error($exception->getMessage(), $context + [
            'exception' => $exception::class,
            'file' => $exception->getFile() . ':' . $exception->getLine(),
            'trace' => explode("\n", $exception->getTraceAsString()),
        ]);
    }

    private function write(string $level, string $message, array $context): void
    {
        $directory = dirname($this->file);
        if (!is_dir($directory) && !@mkdir($directory, 0o770, true) && !is_dir($directory)) {
            return; // never let logging failure break a request
        }

        $line = json_encode([
            'time' => $this->clock->now()->format(DATE_ATOM),
            'level' => $level,
            'message' => $message,
            'context' => $context,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);

        if ($line !== false) {
            @file_put_contents($this->file, $line . PHP_EOL, FILE_APPEND | LOCK_EX);
        }
    }
}
