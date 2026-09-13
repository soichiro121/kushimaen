/**
 * Thin HTTP client for the PHP API.
 *
 * API URLs are never hard-coded at call sites: everything goes through `apiUrl()`,
 * which resolves to a same-origin `/api/...` path in production (so there is no CORS
 * surface at all) and through the Vite dev proxy in development.
 */
import { GAME_CONFIG } from '@/config/game';

/** Requests must not hang forever on a flaky school Wi-Fi connection. */
const DEFAULT_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = 'error',
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when retrying later could plausibly succeed. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${GAME_CONFIG.apiBaseUrl}/api${normalized}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // Same-origin in production; no cookies are used, so credentials stay omitted.
      credentials: 'omit',
      cache: 'no-store',
    });

    const text = await response.text();
    const payload: unknown = text ? safeParse(text) : null;

    if (!response.ok) {
      const detail = extractError(payload);
      throw new ApiError(detail.message, response.status, detail.code);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('リクエストがタイムアウトしました', 0, 'timeout');
    }
    throw new ApiError('サーバーに接続できませんでした', 0, 'network');
  } finally {
    clearTimeout(timer);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractError(payload: unknown): { message: string; code: string } {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error: unknown }).error;
    if (error && typeof error === 'object') {
      const record = error as { message?: unknown; code?: unknown };
      return {
        message: typeof record.message === 'string' ? record.message : 'サーバーエラー',
        code: typeof record.code === 'string' ? record.code : 'error',
      };
    }
  }
  return { message: 'サーバーエラー', code: 'error' };
}
