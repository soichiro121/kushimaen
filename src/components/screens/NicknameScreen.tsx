/**
 * Nickname entry. No account, no login - just a name for the leaderboard.
 *
 * The same sanitisation runs again on the PHP side; this copy exists to give
 * immediate feedback, not as a security measure.
 */
import { useState } from 'react';
import { useRunStore } from '@/stores/runStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  NICKNAME_MAX,
  nicknameErrorMessage,
  nicknameLength,
  sanitizeNickname,
  validateNickname,
} from '@/utils/nickname';
import { Button } from '@/components/ui/Button';
import { Screen, ScreenBody, ScreenFooter, ScreenTitle } from '@/components/ui/Screen';
import styles from './NicknameScreen.module.css';

export function NicknameScreen() {
  const submitNickname = useRunStore((state) => state.submitNickname);
  const retry = useRunStore((state) => state.retry);
  const savedNickname = useSettingsStore((state) => state.nickname);

  const [value, setValue] = useState(savedNickname);
  const [touched, setTouched] = useState(false);

  const error = validateNickname(value);
  const showError = touched && error !== null;
  const remaining = NICKNAME_MAX - nicknameLength(sanitizeNickname(value));

  function handleSubmit(): void {
    setTouched(true);
    if (error) return;
    submitNickname(value);
  }

  return (
    <Screen>
      <ScreenTitle subtitle="ランキングに表示される名前です。あとから設定で変更できます。">
        ニックネーム
      </ScreenTitle>

      <ScreenBody>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <label className={styles.label} htmlFor="nickname">
            名前（{NICKNAME_MAX}文字まで）
          </label>
          <input
            id="nickname"
            className={styles.input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={NICKNAME_MAX * 2}
            autoComplete="nickname"
            enterKeyHint="go"
            aria-invalid={showError}
            aria-describedby={showError ? 'nickname-error' : 'nickname-help'}
          />
          <p id="nickname-help" className={styles.help}>
            残り {Math.max(0, remaining)} 文字
          </p>
          {showError && error ? (
            <p id="nickname-error" className={styles.error} role="alert">
              {nicknameErrorMessage(error)}
            </p>
          ) : null}
          {/* A submit input keeps the on-screen keyboard's "go" key working. */}
          <button type="submit" className={styles.hiddenSubmit} aria-hidden tabIndex={-1} />
        </form>
      </ScreenBody>

      <ScreenFooter>
        <Button large block onClick={handleSubmit} disabled={error !== null}>
          この名前ではじめる
        </Button>
        <Button variant="ghost" block onClick={retry}>
          タイトルに戻る
        </Button>
      </ScreenFooter>
    </Screen>
  );
}
