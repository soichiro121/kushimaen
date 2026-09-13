<?php

declare(strict_types=1);

namespace Komato\Api\Http;

use RuntimeException;
use Throwable;

/**
 * An error that is safe to show a client.
 *
 * Anything thrown that is NOT an ApiException is treated as an internal fault and is
 * reported to the client as a generic 500 - the message and stack trace are logged,
 * never returned, so a database error cannot leak a table name or a file path.
 */
final class ApiException extends RuntimeException
{
    private function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public static function badRequest(string $code, string $message): self
    {
        return new self(400, $code, $message);
    }

    public static function notFound(string $code, string $message): self
    {
        return new self(404, $code, $message);
    }

    public static function conflict(string $code, string $message): self
    {
        return new self(409, $code, $message);
    }

    public static function gone(string $code, string $message): self
    {
        return new self(410, $code, $message);
    }

    /** 422: the request was well-formed JSON but semantically unusable. */
    public static function unprocessable(string $code, string $message, array $details = []): self
    {
        return new self(422, $code, $message, $details);
    }

    public static function tooManyRequests(string $message, int $retryAfterSeconds): self
    {
        return new self(429, 'rate_limited', $message, ['retryAfter' => $retryAfterSeconds]);
    }

    public static function payloadTooLarge(string $message): self
    {
        return new self(413, 'payload_too_large', $message);
    }
}
