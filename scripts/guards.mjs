#!/usr/bin/env node
// Repository guards. Run with `npm run guard` (also runs in CI).
//
// 1. Sync-service independence: Etsy products reach WooCommerce through a third-party synchronization service the owner
//    chooses (and may change). Nothing we ship (storefront, shared packages, the WordPress plugin, deploy files) may call
//    Etsy, reference Etsy's API hosts or credentials, or name a synchronization product. WooCommerce is the only contract.
//    (ADR-014; docs/SYNC-INDEPENDENCE.md.)
// 2. No secret-shaped strings (Stripe keys, webhook secrets, WooCommerce REST keys) in code.
// 3. No secret-like names on NEXT_PUBLIC_ variables (they are exposed to the browser).
//
// Docs are excluded from the secret scan because they legitimately name key prefixes.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'coverage',
  'playwright-report',
  'test-results',
  'dist',
  'build',
  'vendor',
]);
const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|css|html|md|ya?ml|php|txt|env|example|svg)$/i;

/** Patterns are assembled from parts so this file does not match itself. */
const etsyPatterns = [
  new RegExp(['api', 'etsy', 'com'].join('\\.'), 'i'),
  new RegExp(['etsy', 'cloud'].join(''), 'i'),
  new RegExp(['ETSY', '[A-Z0-9_]+'].join('_')),
  new RegExp(['open', 'api/generated'].join('-?'), 'i'),
  new RegExp(['oauth', 'connect'].join('/')),
  /x-api-key/i,
];

const syncServicePatterns = [
  new RegExp(['export', '\\s*-?your', '\\s*-?store'].join(''), 'i'),
  new RegExp(['nem', 'bol'].join(''), 'i'),
];

/** Where the rules above apply: code and configuration we ship. Docs may discuss these services freely. */
const shippedPrefixes = ['apps/', 'packages/', 'wordpress/', 'deploy/', '.github/'];

const secretPatterns = [
  new RegExp(['sk', '(?:live|test)', '[A-Za-z0-9]{10,}'].join('_')),
  new RegExp(['rk', '(?:live|test)', '[A-Za-z0-9]{10,}'].join('_')),
  new RegExp(['whsec', '[A-Za-z0-9+/=]{10,}'].join('_')),
  /\bc[ks]_[0-9a-f]{32,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const publicEnvPattern = /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY)/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (TEXT_EXT.test(name) || name.startsWith('.env')) yield full;
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const violations = [];
const selfPath = fileURLToPath(import.meta.url);

for (const file of walk(root)) {
  if (file === selfPath) continue;
  const rel = relative(root, file).split(sep).join('/');
  const inDocs = rel.startsWith('docs/') || /^(README|CLAUDE|PROJECT_STATUS)\.md$/.test(rel);
  const text = readFileSync(file, 'utf8');

  if (shippedPrefixes.some((prefix) => rel.startsWith(prefix)) || rel === 'Dockerfile') {
    for (const re of etsyPatterns) {
      const m = re.exec(text);
      if (m)
        violations.push(
          `${rel}:${lineOf(text, m.index)} Etsy reference in shipped code: "${m[0]}"`,
        );
    }
    for (const re of syncServicePatterns) {
      const m = re.exec(text);
      if (m)
        violations.push(
          `${rel}:${lineOf(text, m.index)} sync-service name in shipped code: "${m[0]}"`,
        );
    }
  }

  if (!inDocs) {
    for (const re of secretPatterns) {
      const m = re.exec(text);
      if (m)
        violations.push(
          `${rel}:${lineOf(text, m.index)} secret-shaped string: "${m[0].slice(0, 12)}…"`,
        );
    }
  }

  const pub = publicEnvPattern.exec(text);
  if (pub && !inDocs) {
    violations.push(
      `${rel}:${lineOf(text, pub.index)} secret-like NEXT_PUBLIC variable: "${pub[0]}"`,
    );
  }
}

if (violations.length > 0) {
  console.error('Guard violations:\n' + violations.map((v) => `  - ${v}`).join('\n'));
  process.exit(1);
}
console.log(
  'Guards passed: no Etsy or sync-service code in shipped files, no secret-shaped strings, no secret-like public env names.',
);
