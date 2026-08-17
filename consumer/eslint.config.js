import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * This config previously matched `**\/*.{js,jsx}` only, so it linted exactly two
 * files - itself and orval.config.js - while every application source file is
 * .ts/.tsx. `npm run lint` passed and checked nothing.
 *
 * That was not academic: two payment bugs shipped through it. An effect that
 * listed `state.phase` in its dependency array and then set that same phase
 * cancelled its own request and hung the payment page; and a "Try again" button
 * reset a ref that no dependency watched, so it silently did nothing. Both are
 * what react-hooks/exhaustive-deps exists to catch.
 *
 * Modelled on dashboard/eslint.config.js, which already lints TypeScript, but
 * deliberately without its prettier plugin and config: the Consumer has no
 * prettier dependency and no format script, so importing those would fail to
 * resolve.
 */
export default defineConfig([
  // Generated Orval clients are excluded for the same reason the Dashboard
  // excludes them: they are build output and are never hand-edited.
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
    rules: {
      /**
       * Downgraded from error, with a reason rather than to get a green run.
       *
       * This is a React Compiler performance advisory about cascading renders,
       * not a correctness rule. Every current occurrence was inspected: they
       * read external state that only exists after mount (sessionStorage for
       * the order id, window.Razorpay for the CDN script) or clear results
       * before a refetch. None has an effect-free alternative that preserves
       * current behaviour.
       *
       * Restructuring proven payment code to satisfy a perf advisory
       * immediately before go-live is the larger risk - two payment bugs this
       * cycle came from restructuring effects. Left as a warning so new
       * occurrences still surface for review.
       */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
