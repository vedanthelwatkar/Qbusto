import { fileURLToPath, URL } from 'node:url';

import { defineConfig, loadEnv } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

/**
 * Dev-server port comes from PORT in .env, defaulting to 5175.
 *
 * Deliberately not VITE_-prefixed: this configures the dev server only and has
 * no business being inlined into the client bundle.
 *
 * `strictPort` makes a clash fail loudly. Vite's default is to pick the next
 * free port silently, which is how an app ends up served from an unexpected
 * origin - the backend's CORS list and any absolute URLs then no longer match,
 * and the cause is easy to miss.
 */
export default defineConfig(({ mode }) => {
  // Third argument '' loads every variable, not just the VITE_ prefixed ones.
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.PORT) || 5175;

  return {
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port,
      strictPort: true,
    },
    // `npm run preview` serves the built bundle on the same port, so the
    // backend's CORS list does not need a second entry per app.
    preview: {
      port,
      strictPort: true,
    },
  };
});
