<?php

declare(strict_types=1);

namespace Komato\Api\Support;

use Random\RandomException;

/**
 * Identifier and seed generation.
 *
 * Both must be unguessable: a predictable run id would let someone submit against
 * somebody else's run, and a predictable seed would let a player pre-compute an easy
 * layout before starting. `random_bytes` is a CSPRNG, unlike `rand()`/`mt_rand()`.
 */
final class Ids
{
    /** RFC 4122 version 4 UUID. */
    public static function uuidV4(): string
    {
        $bytes = self::randomBytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    /** An unsigned 32-bit seed, matching the range the client's PRNG expects. */
    public static function seed(): int
    {
        $bytes = self::randomBytes(4);
        /** @var array{1: int} $unpacked */
        $unpacked = unpack('N', $bytes);
        return $unpacked[1] & 0xFFFFFFFF;
    }

    private static function randomBytes(int $length): string
    {
        try {
            return random_bytes($length);
        } catch (RandomException $exception) {
            // No usable entropy source is an environment failure, not something to
            // paper over with a weak fallback.
            throw new \RuntimeException('Secure randomness is unavailable', 0, $exception);
        }
    }
}
