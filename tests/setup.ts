/**
 * Vitest setup.
 *
 * Most tests cover pure logic (scoring, RNG, validation, problem generation, the
 * stealth model), so no Phaser/WebGL environment is created. A few browser APIs are
 * stubbed because modules under test touch them at import time.
 *
 * The API tests under `tests/server/` opt into the `node` environment instead, so
 * every browser global here has to be optional.
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
  // The API tests run in the `node` environment (they need real WASM and Node
  // crypto), where there is no localStorage to clear.
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
