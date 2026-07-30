/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUD_APP_ORIGIN?: string;
  /** When `"true"`, mount marketing at `/` (Pages). Default keeps `/www`. */
  readonly VITE_MARKETING_AT_ROOT?: string;
  /** Optional override for marketing prefix (e.g. `""` or `/www`). */
  readonly VITE_MARKETING_BASE?: string;
  readonly VITE_ALLOW_SESSION_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
