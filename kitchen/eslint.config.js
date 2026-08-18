import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * The starter config this replaced matched `**\/*.{js,jsx}` only, so it linted
 * exactly two files - itself and orval.config.js - while every application
 * source file is .ts/.tsx. `npm run lint` reported success and checked none of
 * the app.
 *
 * That is not a theoretical problem. The identical bug in the Consumer app hid
 * two real defects until it was fixed: an effect that listed a value in its
 * dependency array and then set that same value, and a retry button that reset
 * a ref nothing watched. Both are what react-hooks/exhaustive-deps exists to
 * catch, and this app has the same shape of code - a polling effect, a ticking
 * clock, and a store read from callbacks.
 *
 * Modelled on dashboard/eslint.config.js but without its prettier plugin: the
 * Kitchen has no prettier dependency and no format script, so importing those
 * would fail to resolve.
 */
export default defineConfig([
  // Build output and generated Orval clients. Both are reproducible from their
  // source and are never hand-edited, exactly as the Dashboard treats them.
  globalIgnores(['dist', 'src/api/generated']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
]);
