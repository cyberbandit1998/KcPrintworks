// The installable package of the custom quotes plugin: what is in it, what is not, and that nothing secret or test-only is shipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
execFileSync('node', [`${root}scripts/build-quotes-plugin.mjs`], { stdio: 'pipe' });
const zip = `${root}dist/kcpw-quotes.zip`;
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

test('the package contains what WordPress needs, under one folder named like the plugin', () => {
  assert.ok(entries.every((e) => e.startsWith('kcpw-quotes/')));
  for (const need of [
    'kcpw-quotes/kcpw-quotes.php',
    'kcpw-quotes/uninstall.php',
    'kcpw-quotes/README.md',
    'kcpw-quotes/src/Support/Autoloader.php',
    'kcpw-quotes/src/Domain/QuoteInput.php',
    'kcpw-quotes/src/Domain/ApprovalInput.php',
    'kcpw-quotes/src/Service/Customer.php',
    'kcpw-quotes/src/Service/Payments.php',
    'kcpw-quotes/src/Service/Intake.php',
    'kcpw-quotes/src/Service/Admin.php',
    'kcpw-quotes/src/Wp/Plugin.php',
    'kcpw-quotes/src/Wp/RestApi.php',
    'kcpw-quotes/src/Wp/WcOrderGateway.php',
    'kcpw-quotes/src/Wp/OrderHooks.php',
    'kcpw-quotes/src/Wp/AdminScreens.php',
    'kcpw-quotes/src/Wp/WpdbQuoteRepository.php',
    'kcpw-quotes/src/Wp/Schema.php',
  ]) {
    assert.ok(entries.includes(need), `missing ${need}`);
  }
});

test('tests, fixtures and stand-ins are not shipped, and nothing looks like a secret', () => {
  for (const entry of entries) {
    assert.equal(/\/tests?\//.test(entry), false, entry);
    assert.equal(/standin|fixture|vectors|\.env/.test(entry), false, entry);
  }
  const dir = mkdtempSync(join(tmpdir(), 'kcpw-quotes-zip-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', dir]);
    const walk = (d) =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      assert.equal(
        /sk_(live|test)_|whsec_|ck_[0-9a-f]{20}|BEGIN (RSA )?PRIVATE KEY/.test(text),
        false,
        file,
      );
      if (file.endsWith('.php')) {
        const lint = spawnSync('php', ['-l', file], { encoding: 'utf8' });
        assert.equal(lint.status, 0, `${file}: ${lint.stdout}${lint.stderr}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the plugin header has a name, a version, a license and a text domain, and the version matches the constant', () => {
  const file = readFileSync(`${root}wordpress/kcpw-quotes/kcpw-quotes.php`, 'utf8');
  const head = file.slice(0, 2500);
  assert.match(head, /Plugin Name:\s+KCPrintWorks Custom Quotes/);
  assert.match(head, /Requires Plugins:\s+woocommerce/);
  assert.match(head, /License:\s+GPL-2\.0-or-later/);
  assert.match(head, /Text Domain:\s+kcpw-quotes/);
  const version = /Version:\s+(\S+)/.exec(head)[1];
  assert.ok(file.includes(`define('KCPW_QUOTES_VERSION', '${version}')`));
});

test('the plugin stays out of checkout, products and payments', () => {
  const dir = `${root}wordpress/kcpw-quotes/src`;
  const walk = (d) =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const source = walk(dir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  // Nothing hooks the cart, the checkout form, a payment gateway or product data; the three order hooks are the whole WooCommerce surface.
  for (const hook of [
    'woocommerce_add_to_cart',
    'woocommerce_checkout_',
    'woocommerce_payment_gateways',
    'woocommerce_before_calculate_totals',
    'woocommerce_product_',
    'woocommerce_available_payment_gateways',
    'woocommerce_package_rates',
  ]) {
    assert.equal(source.includes(hook), false, hook);
  }
  const hooks = [...source.matchAll(/add_(?:action|filter)\('(woocommerce_[a-z_]+)'/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(hooks, [
    'woocommerce_cancel_unpaid_order',
    'woocommerce_order_needs_payment',
    'woocommerce_order_status_changed',
  ]);
});
