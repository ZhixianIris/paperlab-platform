/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDBASE_ENV_ID?: string;
  readonly VITE_CLOUDBASE_REGION?: string;
  readonly VITE_CLOUDBASE_PUBLISHABLE_KEY?: string;
  readonly VITE_E2E_MODE?: string;
  readonly VITE_E2E_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
