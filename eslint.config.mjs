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
    // Code that can run in the browser must use the zod-free entry (about 115 KB of JavaScript saved on
    // every page). Types are erased at build time, so `import type` from the full entry is fine anywhere.
    files: [
      'apps/storefront/src/components/**/*.{ts,tsx}',
      'apps/storefront/src/lib/cart/**/*.{ts,tsx}',
      'apps/storefront/src/lib/variation.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@kcpw/contracts',
              message:
                "Import runtime code from '@kcpw/contracts/client' (no zod). Use `import type` for types. Load schemas lazily with import().",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
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
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        Response: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
      },
    },
  },
];
