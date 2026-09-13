/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the PHP API. Empty string = same-origin `/api` (the production default). */
  readonly VITE_API_BASE_URL?: string;
  /** Comma-separated stage ids to hide without a code change, e.g. `teacher`. */
  readonly VITE_DISABLED_STAGES?: string;
  /** Overrides the title shown on the title screen. */
  readonly VITE_TITLE?: string;
  /** `1` puts the app into a maintenance screen. */
  readonly VITE_MAINTENANCE?: string;
  /** Global difficulty multiplier (ops lever). Default `1`. */
  readonly VITE_DIFFICULTY_SCALE?: string;
  /** `1` exposes /dev routes in a production build (normally dev-only). */
  readonly VITE_ENABLE_DEV_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
