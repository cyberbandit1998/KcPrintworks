import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const storefrontFiles = ['apps/storefront/**/*.{js,jsx,mjs,ts,tsx}'];

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      'wordpress/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...[...nextVitals, ...nextTs].map((config) => ({
    ...config,
    files: storefrontFiles,
  })),
  {
    files: storefrontFiles,
    settings: { next: { rootDir: 'apps/storefront/' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs', '**/*.config.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
];
