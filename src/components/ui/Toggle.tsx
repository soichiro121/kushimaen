/**
 * On/off row used by the settings sheet.
 *
 * Renders a real `role="switch"` with the state also written as text, so the setting
 * is understandable without relying on colour alone.
 */
import { audioService } from '@/services/audio/AudioService';
import styles from './Toggle.module.css';

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}

export function Toggle({ label, hint, checked, disabled = false, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.row}
      onClick={() => {
        audioService.playSe('common.se.click');
        onChange(!checked);
      }}
    >
      <span>
        <span className={styles.label}>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={styles.state}>{checked ? 'ON' : 'OFF'}</span>
        <span className={`${styles.track} ${checked ? styles.trackOn : ''}`}>
          <span className={`${styles.knob} ${checked ? styles.knobOn : ''}`} />
        </span>
      </span>
    </button>
  );
}
