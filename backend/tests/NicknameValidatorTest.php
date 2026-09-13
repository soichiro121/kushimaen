<?php

declare(strict_types=1);

namespace Komato\Api\Tests;

use Komato\Api\Config\RuleSet;
use Komato\Api\Validation\NicknameValidator;
use PHPUnit\Framework\TestCase as BaseTestCase;

/**
 * Nickname rules.
 *
 * The leaderboard is a public, shared surface in a school, so a name has to be
 * harmless: no invisible characters, no control codes, no unbounded length, and
 * nothing that can scramble the rendering of the rows around it.
 */
final class NicknameValidatorTest extends BaseTestCase
{
    private NicknameValidator $validator;
    private RuleSet $rules;

    protected function setUp(): void
    {
        $this->rules = RuleSet::load();
        $this->validator = new NicknameValidator($this->rules);
    }

    public function testOrdinaryNamesPassThroughUnchanged(): void
    {
        self::assertSame('テスト太郎', $this->validator->sanitize('テスト太郎'));
        self::assertSame('Komato 2026', $this->validator->sanitize('Komato 2026'));
        self::assertNull($this->validator->validate('テスト太郎'));
    }

    public function testSurroundingAndRepeatedWhitespaceIsCollapsed(): void
    {
        self::assertSame('a b', $this->validator->sanitize("  a \t\n b  "));
    }

    public function testControlCharactersAreStripped(): void
    {
        self::assertSame('abc', $this->validator->sanitize("a\x00b\x1fc"));
        self::assertSame('ab', $this->validator->sanitize("a\x07b"));
    }

    public function testInvisibleAndBidiCharactersAreStripped(): void
    {
        // A zero-width space would otherwise pass as a "non-empty" name.
        self::assertSame('', $this->validator->sanitize("\u{200B}\u{FEFF}"));
        self::assertSame('empty', $this->validator->validate("\u{200B}"));

        // A right-to-left override can reorder the whole row it is rendered in.
        self::assertSame('ab', $this->validator->sanitize("a\u{202E}b"));
    }

    public function testOverlongNamesAreTruncatedToTheSharedLimit(): void
    {
        $max = $this->rules->nicknameMaxLength();
        $clean = $this->validator->sanitize(str_repeat('あ', $max + 40));

        self::assertSame($max, mb_strlen($clean, 'UTF-8'));
        self::assertNull($this->validator->validate($clean));
    }

    public function testTruncationCountsCharactersNotBytes(): void
    {
        // Multi-byte input must not be cut mid-character.
        $clean = $this->validator->sanitize(str_repeat('🍞', 30));

        self::assertSame($this->rules->nicknameMaxLength(), mb_strlen($clean, 'UTF-8'));
        self::assertTrue(mb_check_encoding($clean, 'UTF-8'));
    }

    public function testEmptyAndWhitespaceOnlyNamesAreRejected(): void
    {
        self::assertSame('empty', $this->validator->validate(''));
        self::assertSame('empty', $this->validator->validate('     '));
    }

    public function testInvalidUtf8IsRejectedRatherThanStored(): void
    {
        self::assertSame('', $this->validator->sanitize("\xC3\x28"));
        self::assertSame('empty', $this->validator->validate("\xC3\x28"));
    }

    /**
     * HTML is deliberately NOT escaped here: the API returns JSON and the client
     * renders it as text. Escaping on the way in would double-encode and leave
     * `&lt;b&gt;` visible on the leaderboard.
     */
    public function testMarkupIsStoredVerbatimAndLeftForTheRendererToEscape(): void
    {
        self::assertSame('<b>hi</b>', $this->validator->sanitize('<b>hi</b>'));
    }
}
