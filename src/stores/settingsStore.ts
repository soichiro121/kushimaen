/**
 * Player settings: audio, vibration, nickname.
 *
 * Persisted to localStorage so a returning player keeps their preferences and does
 * not retype a nickname. Every setter also applies the change to the relevant
 * service, so there is exactly one source of truth.
 */
import { create } from 'zustand';
import { readJson, writeJson } from '@/services/storage/localStore';
import { audioService } from '@/services/audio/AudioService';
import { setHapticsEnabled } from '@/services/haptics/haptics';
import { sanitizeNickname } from '@/utils/nickname';

const STORAGE_KEY = 'settings';

export interface Settings {
  bgmEnabled: boolean;
  seEnabled: boolean;
  vibrationEnabled: boolean;
  nickname: string;
}

const DEFAULTS: Settings = {
  bgmEnabled: true,
  seEnabled: true,
  vibrationEnabled: true,
  nickname: '',
};

function validate(value: unknown): Settings | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<Record<keyof Settings, unknown>>;
  return {
    bgmEnabled: typeof raw.bgmEnabled === 'boolean' ? raw.bgmEnabled : DEFAULTS.bgmEnabled,
    seEnabled: typeof raw.seEnabled === 'boolean' ? raw.seEnabled : DEFAULTS.seEnabled,
    vibrationEnabled:
      typeof raw.vibrationEnabled === 'boolean' ? raw.vibrationEnabled : DEFAULTS.vibrationEnabled,
    nickname: typeof raw.nickname === 'string' ? sanitizeNickname(raw.nickname) : '',
  };
}

interface SettingsState extends Settings {
  setBgmEnabled(value: boolean): void;
  setSeEnabled(value: boolean): void;
  setVibrationEnabled(value: boolean): void;
  setNickname(value: string): void;
  /** Pushes the persisted values into the audio/haptics services. */
  applyToServices(): void;
}

const initial = readJson<Settings>(STORAGE_KEY, validate, DEFAULTS);

function persist(settings: Settings): void {
  writeJson(STORAGE_KEY, settings);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,

  setBgmEnabled(value) {
    audioService.setBgmEnabled(value);
    set({ bgmEnabled: value });
    persist(snapshot(get()));
  },

  setSeEnabled(value) {
    audioService.setSeEnabled(value);
    set({ seEnabled: value });
    persist(snapshot(get()));
  },

  setVibrationEnabled(value) {
    setHapticsEnabled(value);
    set({ vibrationEnabled: value });
    persist(snapshot(get()));
  },

  setNickname(value) {
    const nickname = sanitizeNickname(value);
    set({ nickname });
    persist(snapshot(get()));
  },

  applyToServices() {
    const state = get();
    audioService.setBgmEnabled(state.bgmEnabled);
    audioService.setSeEnabled(state.seEnabled);
    setHapticsEnabled(state.vibrationEnabled);
  },
}));

function snapshot(state: SettingsState): Settings {
  return {
    bgmEnabled: state.bgmEnabled,
    seEnabled: state.seEnabled,
    vibrationEnabled: state.vibrationEnabled,
    nickname: state.nickname,
  };
}
