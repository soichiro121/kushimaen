/**
 * Vitest setup.
 *
 * The unit tests cover pure logic (scoring, RNG, validation, problem generation,
 * state machines), so no Phaser/WebGL environment is created. A few browser APIs are
 * stubbed because modules under test touch them at import time.
 */
import { beforeEach, vi } from 'vitest';

// jsdom has no Web Audio; the audio service must degrade quietly rather than throw.
if (!('AudioContext' in globalThis)) {
  Object.defineProperty(globalThis, 'AudioContext', { value: undefined, writable: true });
}

if (!globalThis.matchMedia) {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
});
