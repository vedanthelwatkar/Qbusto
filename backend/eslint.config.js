'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'logs/**'],
  },

  js.configs.recommended,
  prettierConfig,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    plugins: { prettier },
    rules: {
      'prettier/prettier': 'warn',

      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'warn',
      'no-return-await': 'error',
      // Deliberately off: it conflicts with no-return-await. A thin async
      // wrapper that returns a promise without awaiting it is the correct
      // pattern, and this rule flags exactly that.
      'require-await': 'off',
    },
  },

  {
    // Migrations and seeders receive queryInterface/Sequelize whether or not a
    // given file uses both.
    files: ['migrations/**/*.js', 'seeders/**/*.js'],
    rules: {
      'no-unused-vars': 'off',
    },
  },

  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
];
