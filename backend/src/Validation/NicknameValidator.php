<?php

declare(strict_types=1);

namespace Komato\Api\Validation;

use Komato\Api\Config\RuleSet;

/**
 * Nickname sanitisation.
 *
 * MIRRORS: `src/utils/nickname.ts`. The client sanitises for a good UX; this copy is
 * the one that matters, because a client is never trusted.
 *
 * Removed here:
 *   - C0/C1 control characters (break log output and CSV exports),
 *   - zero-width and bidi-override characters, which can be used to fake an "empty"
 *     name or to scramble the rendering of the whole leaderboard,
 *   - repeated whitespace.
 *
 * NOT done here: HTML escaping. The API returns JSON and the React client renders it
 * as text, so escaping on the way in would double-encode. Escaping is the renderer's
 * job, at the point of output.
 */
final class NicknameValidator
{
    private const INVISIBLE_PATTERN = '/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}\x{FEFF}]/u';
    private const CONTROL_PATTERN = '/[\x{0000}-\x{001F}\x{007F}-\x{009F}]/u';

    public function __construct(private readonly RuleSet $rules)
    {
    }

    public function sanitize(string $input): string
    {
        // Reject invalid UTF-8 outright rather than letting mb_* guess at it.
        if (!mb_check_encoding($input, 'UTF-8')) {
            return '';
        }

        // ext-intl is not guaranteed on shared hosting, so NFC normalisation is a
        // best-effort step. Everything below this line works with or without it.
        $value = $input;
        if (class_exists(\Normalizer::class) && !\Normalizer::isNormalized($input, \Normalizer::FORM_C)) {
            $value = \Normalizer::normalize($input, \Normalizer::FORM_C) ?: $input;
        }

        $value = (string) preg_replace(self::CONTROL_PATTERN, '', $value);
        $value = (string) preg_replace(self::INVISIBLE_PATTERN, '', $value);
        $value = (string) preg_replace('/\s+/u', ' ', $value);
        $value = trim($value);

        return mb_substr($value, 0, $this->rules->nicknameMaxLength(), 'UTF-8');
    }

    /** @return string|null the error code, or null when valid */
    public function validate(string $input): ?string
    {
        $clean = $this->sanitize($input);
        $length = mb_strlen($clean, 'UTF-8');

        if ($length < $this->rules->nicknameMinLength()) {
            return 'empty';
        }
        if ($length > $this->rules->nicknameMaxLength()) {
            return 'too_long';
        }
        return null;
    }
}
