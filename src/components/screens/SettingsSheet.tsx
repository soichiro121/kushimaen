/**
 * Settings sheet: audio, vibration, nickname.
 *
 * Everything here is persisted to localStorage immediately, so a player never has to
 * "save". The vibration row is disabled (and says why) on devices without the API -
 * iOS Safari in particular - rather than silently doing nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { hapticsSupported, vibrate, HAPTIC_PATTERNS } from '@/services/haptics/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { NICKNAME_MAX, sanitizeNickname, validateNickname } from '@/utils/nickname';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import styles from './SettingsSheet.module.css';

export function SettingsSheet({ onClose }: { onClose(): void }) {
  const settings = useSettingsStore();
  const [nickname, setNickname] = useState(settings.nickname);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const supportsHaptics = hapticsSupported();

  // Close on Escape for keyboard users; the backdrop handles touch.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function commitNickname(): void {
    if (validateNickname(nickname) === null) settings.setNickname(nickname);
    else setNickname(settings.nickname);
  }

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="設定"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className={styles.title}>設定</h2>

        <div className={styles.group}>
          <Toggle label="BGM" checked={settings.bgmEnabled} onChange={settings.setBgmEnabled} />
          <Toggle label="効果音" checked={settings.seEnabled} onChange={settings.setSeEnabled} />
          <Toggle
            label="振動"
            hint={supportsHaptics ? undefined : 'この端末は振動に対応していません'}
            checked={settings.vibrationEnabled && supportsHaptics}
            disabled={!supportsHaptics}
            onChange={(value) => {
              settings.setVibrationEnabled(value);
              if (value) vibrate(HAPTIC_PATTERNS.success);
            }}
          />
        </div>

        <label className={styles.label} htmlFor="settings-nickname">
          ニックネーム（{NICKNAME_MAX}文字まで）
        </label>
        <input
          id="settings-nickname"
          className={styles.input}
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          onBlur={commitNickname}
          maxLength={NICKNAME_MAX * 2}
        />
        <p className={styles.help}>保存名: {sanitizeNickname(nickname) || '（未設定）'}</p>

        <Button
          block
          onClick={() => {
            commitNickname();
            onClose();
          }}
        >
          閉じる
        </Button>
      </div>
    </div>
  );
}
