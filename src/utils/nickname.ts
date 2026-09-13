/**
 * Nickname rules.
 *
 * MIRRORED IN PHP: `backend/src/Validation/NicknameValidator.php`.
 * The client sanitises for a good UX; the server sanitises again because a client is
 * never trusted. Both read min/max from `shared/game-rules/vN.json`, and both count
 * length in Unicode code points so a name never gets cut differently on each side.
 */
import { RULES } from '@/config/rules';

export const NICKNAME_MIN = RULES.nickname.minLength;
export const NICKNAME_MAX = RULES.nickname.maxLength;

/**
 * C0 and C1 control characters.
 * The lint rule exists to catch accidental control characters in a pattern; here they
 * are exactly what we are stripping, so the rule is disabled deliberately.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Zero-width and bidi-override characters. These are invisible, so they can be used
 * to fake an "empty" name or to scramble the rendering of the whole leaderboard.
 */
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export function sanitizeNickname(input: string): string {
  const cleaned = input
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Slice by code point so an emoji is never cut in half.
  return [...cleaned].slice(0, NICKNAME_MAX).join('');
}

export function nicknameLength(input: string): number {
  return [...input].length;
}

export type NicknameError = 'empty' | 'tooLong';

export function validateNickname(input: string): NicknameError | null {
  const cleaned = sanitizeNickname(input);
  const length = nicknameLength(cleaned);
  if (length < NICKNAME_MIN) return 'empty';
  if (length > NICKNAME_MAX) return 'tooLong';
  return null;
}

export function nicknameErrorMessage(error: NicknameError): string {
  switch (error) {
    case 'empty':
      return 'ニックネームを入力してください';
    case 'tooLong':
      return `ニックネームは${NICKNAME_MAX}文字までです`;
  }
}
