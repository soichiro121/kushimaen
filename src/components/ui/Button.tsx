/**
 * The app's only button.
 *
 * Enforces the minimum touch target and plays the shared click sound, so no screen
 * can accidentally ship a 30px tap area or a silent control.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { audioService } from '@/services/audio/AudioService';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  block?: boolean;
  large?: boolean;
  /** Set to false for controls that make their own sound. */
  sound?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  block = false,
  large = false,
  sound = true,
  onClick,
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    block ? styles.block : '',
    large ? styles.large : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={(event) => {
        if (sound) audioService.playSe('common.se.click');
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
