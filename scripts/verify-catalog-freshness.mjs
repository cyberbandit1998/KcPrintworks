#!/usr/bin/env node
// Check that a WooCommerce change shows up on the storefront WITHOUT rebuilding or restarting anything.
// Dependency-free; read-only against WooCommerce (it never talks to WooCommerce at all, only to the storefront).
//
//   node scripts/verify-catalog-freshness.mjs status  --base https://staging.example.com
//   node scripts/verify-catalog-freshness.mjs wait    --base ... --path /product/my-product/ --expect "New title"
//   node scripts/verify-catalog-freshness.mjs wait    --base ... --path /product/my-product/ --gone "Old title"
//   node scripts/verify-catalog-freshness.mjs refresh --base ...          (needs REVALIDATE_SECRET in the environment)
//
// The secret is read from the environment only, never from an argument (arguments end up in shell history and
// process lists), and is never printed. Exit code: 0 passed, 1 failed or timed out, 2 usage error.
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const USAGE = `Usage:
  verify-catalog-freshness.mjs status  --base <url> [--product <id|slug>]
  verify-catalog-freshness.mjs wait    --base <url> --path </product/slug/> (--expect <text> | --gone <text>) [--timeout 300] [--interval 5]
  verify-catalog-freshness.mjs refresh --base <url>        (REVALIDATE_SECRET must be set in the environment)`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument "${token}"`);
    const name = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    options[name] = value;
    i += 1;
  }
  return { command, options };
}

export function normalizeBase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`--base "${raw}" is not a URL`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('--base must be https (plain http is only allowed for localhost)');
  }
  return url.origin;
}

/** HMAC-SHA256 of the exact bytes sent, as the storefront's /api/revalidate/ expects (`sha256=<hex>`). */
export function signBody(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function buildRefreshRequest(base, secret, now = new Date()) {
  if (!secret || secret.length < 16) {
    throw new Error('Set REVALIDATE_SECRET (at least 16 characters) in your environment first.');
  }
  const body = JSON.stringify({ source: 'verify-catalog-freshness', at: now.toISOString() });
  return {
    url: `${base}/api/revalidate/`,
    init: {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'x-kcpw-signature': signBody(body, secret) },
    },
  };
}

/** Polls `check` until it returns a truthy value or the timeout passes. Injectable clock for tests. */
export async function pollUntil(
  check,
  { timeoutMs, intervalMs, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now },
) {
  const started = now();
  for (;;) {
    const result = await check();
    if (result) return { ok: true, elapsedMs: now() - started, result };
    if (now() - started + intervalMs > timeoutMs) return { ok: false, elapsedMs: now() - started };
    await sleep(intervalMs);
  }
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

async function status(base, options, fetchImpl, log) {
  const response = await fetchImpl(`${base}/api/catalog-status/`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    log(`FAIL  ${base}/api/catalog-status/ answered HTTP ${response.status}`);
    return 1;
  }
  const data = await response.json();
  if (data.source !== 'woo') {
    log(`FAIL  this storefront is not reading WooCommerce (catalog source: ${data.source})`);
    return 1;
  }
  log(
    `Catalog source: WooCommerce   products: ${data.counts?.products ?? '?'}   categories: ${data.counts?.categories ?? '?'}`,
  );
  log(
    `Last loaded:    ${data.status.loadedAt ?? 'never'} (${data.status.ageSeconds ?? '?'}s ago; refreshes in the background every ${data.status.refreshIntervalSeconds}s)`,
  );
  if (data.status.lastError)
    log(
      `Last error:     ${data.status.lastError}   (serving the last good copy; failures so far: ${data.status.failures})`,
    );
  if (data.counts?.skipped) {
    log(`Not shown (${data.counts.skipped}):`);
    for (const row of data.skipped) log(`  #${row.id} ${row.title}: ${row.reason}`);
  }
  if (options.product) {
    const match = data.products.find(
      (p) => String(p.id) === options.product || p.slug === options.product,
    );
    if (!match) {
      log(`FAIL  no product "${options.product}" in the storefront's catalog`);
      return 1;
    }
    log(
      `Product #${match.id} ${match.name}: $${(match.price / 100).toFixed(2)}, ${match.variations} variations, modified ${match.updatedAt}`,
    );
  }
  return data.status.lastError && data.counts?.products === 0 ? 1 : 0;
}

async function wait(base, options, fetchImpl, log) {
  if (!options.path?.startsWith('/'))
    throw new Error('--path must start with "/", for example /product/my-product/');
  const wantText = options.expect;
  const goneText = options.gone;
  if ((wantText === undefined) === (goneText === undefined))
    throw new Error('Give exactly one of --expect or --gone');
  const timeoutMs = Number(options.timeout ?? 300) * 1000;
  const intervalMs = Number(options.interval ?? 5) * 1000;
  if (!(timeoutMs > 0) || !(intervalMs > 0))
    throw new Error('--timeout and --interval must be positive numbers of seconds');
  const url = `${base}${options.path}`;
  log(
    `Waiting for ${goneText === undefined ? `"${wantText}" to appear on` : `"${goneText}" to disappear from`} ${url}`,
  );
  log(
    'Make the change in WooCommerce now if you have not yet (this script never changes anything).',
  );
  const result = await pollUntil(
    async () => {
      const response = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
        headers: { 'cache-control': 'no-cache' },
      });
      const html = await response.text();
      const found = html.includes(wantText ?? goneText);
      return goneText === undefined ? found : !found && response.ok;
    },
    { timeoutMs, intervalMs },
  );
  if (result.ok) {
    log(`PASS  visible after ${seconds(result.elapsedMs)} (no rebuild, no restart)`);
    return 0;
  }
  log(
    `FAIL  not visible after ${seconds(result.elapsedMs)}. Run "status" to see when the storefront last loaded and whether WooCommerce errored.`,
  );
  return 1;
}

async function refresh(base, fetchImpl, log, env) {
  const { url, init } = buildRefreshRequest(base, env.REVALIDATE_SECRET);
  const response = await fetchImpl(url, init);
  if (response.status === 202) {
    log('PASS  the storefront accepted the refresh request and is reloading the catalog');
    return 0;
  }
  const hint =
    response.status === 401
      ? 'the secret does not match the one on the server'
      : response.status === 503
        ? 'the server has no REVALIDATE_SECRET (or WooCommerce credentials) configured'
        : response.status === 404
          ? 'this storefront is not using the WooCommerce catalog source'
          : 'unexpected answer';
  log(`FAIL  HTTP ${response.status}: ${hint}`);
  return 1;
}

export async function main(argv, { fetchImpl = fetch, log = console.log, env = process.env } = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    if (!['status', 'wait', 'refresh'].includes(parsed.command)) throw new Error(USAGE);
    if (!parsed.options.base) throw new Error('--base is required');
    const base = normalizeBase(parsed.options.base);
    if (parsed.command === 'status') return await status(base, parsed.options, fetchImpl, log);
    if (parsed.command === 'wait') return await wait(base, parsed.options, fetchImpl, log);
    return await refresh(base, fetchImpl, log, env);
  } catch (error) {
    log(`${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
