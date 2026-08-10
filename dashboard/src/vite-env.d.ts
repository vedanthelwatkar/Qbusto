/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Server root, with no path. The API router is mounted at /api, and request
   * paths already include it - so this must not end in /api.
   */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
