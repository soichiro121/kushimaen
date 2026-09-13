/**
 * Defensive localStorage wrapper.
 *
 * Storage throws in more situations than people expect on mobile: Safari private
 * mode, "block all cookies", a full quota, or an embedded webview. None of those may
 * break the game, so every access is guarded and failures degrade to in-memory state.
 */

const NAMESPACE = 'komato';

/** Used when the real storage is unavailable, so the session still behaves normally. */
const memoryFallback = new Map<string, string>();

function key(name: string): string {
  return `${NAMESPACE}:${name}`;
}

function storage(): Storage | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    // Safari only throws on write, so probe with a real round-trip.
    const probe = `${NAMESPACE}:__probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function readString(name: string): string | null {
  const store = storage();
  if (!store) return memoryFallback.get(key(name)) ?? null;
  try {
    return store.getItem(key(name));
  } catch {
    return null;
  }
}

export function writeString(name: string, value: string): void {
  const store = storage();
  if (!store) {
    memoryFallback.set(key(name), value);
    return;
  }
  try {
    store.setItem(key(name), value);
  } catch {
    memoryFallback.set(key(name), value);
  }
}

export function removeKey(name: string): void {
  memoryFallback.delete(key(name));
  try {
    storage()?.removeItem(key(name));
  } catch {
    /* ignore */
  }
}

/**
 * Reads and validates JSON. A corrupt or outdated value returns the fallback rather
 * than propagating a parse error into a render.
 */
export function readJson<T>(name: string, validate: (value: unknown) => T | null, fallback: T): T {
  const raw = readString(name);
  if (raw === null) return fallback;
  try {
    const parsed = validate(JSON.parse(raw));
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown): void {
  try {
    writeString(name, JSON.stringify(value));
  } catch {
    /* ignore - a value we cannot serialise is not worth crashing for */
  }
}
