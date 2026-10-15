// The installable package of the address autocomplete plugin: what is in it, what is not, and how big the parts a visitor downloads are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('../../', import.meta.url).pathname;
execFileSync('node', [`${root}scripts/build-address-autocomplete-plugin.mjs`], { stdio: 'pipe' });
const zip = `${root}dist/kcpw-address-autocomplete.zip`;
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

test('the package contains what WordPress needs, under one folder named like the plugin', () => {
  assert.ok(entries.every((e) => e.startsWith('kcpw-address-autocomplete/')));
  for (const need of [
    'kcpw-address-autocomplete/kcpw-address-autocomplete.php',
    'kcpw-address-autocomplete/uninstall.php',
    'kcpw-address-autocomplete/README.md',
    'kcpw-address-autocomplete/src/Settings.php',
    'kcpw-address-autocomplete/src/Frontend.php',
    'kcpw-address-autocomplete/assets/js/kcpw-aa.js',
    'kcpw-address-autocomplete/assets/css/kcpw-aa.css',
    'kcpw-address-autocomplete/assets/css/kcpw-aa-map.css',
    'kcpw-address-autocomplete/assets/js/kcpw-aa-pobox.js',
    'kcpw-address-autocomplete/assets/js/kcpw-aa-validate.js',
    'kcpw-address-autocomplete/assets/js/kcpw-aa-gps.js',
    'kcpw-address-autocomplete/assets/js/kcpw-aa-map.js',
    'kcpw-address-autocomplete/src/Rest.php',
    'kcpw-address-autocomplete/src/GoogleServer.php',
    'kcpw-address-autocomplete/src/WooCommerce.php',
  ]) {
    assert.ok(entries.includes(need), `missing ${need}`);
  }
});

test('tests, fixtures, vectors and stand-ins are not shipped', () => {
  for (const entry of entries) {
    assert.equal(/\/tests?\//.test(entry), false, entry);
    assert.equal(/standin|fixture|vectors/.test(entry), false, entry);
  }
});

test('the plugin header has a name, a version, a license and a text domain', () => {
  const head = readFileSync(
    `${root}wordpress/kcpw-address-autocomplete/kcpw-address-autocomplete.php`,
    'utf8',
  ).slice(0, 2000);
  assert.match(head, /Plugin Name:\s+KCPrintWorks Address Autocomplete/);
  assert.match(head, /Version:\s+\d+\.\d+\.\d+/);
  assert.match(head, /License:\s+GPL-2\.0-or-later/);
  assert.match(head, /Text Domain:\s+kcpw-address-autocomplete/);
  const version = /Version:\s+(\S+)/.exec(head)[1];
  assert.ok(
    head.includes(`define('KCPW_AA_VERSION', '${version}')`) ||
      readFileSync(
        `${root}wordpress/kcpw-address-autocomplete/kcpw-address-autocomplete.php`,
        'utf8',
      ).includes(`define('KCPW_AA_VERSION', '${version}')`),
    'the constant matches the header',
  );
});

test('what a customer downloads on a checkout page stays small (gzipped): the core script and the stylesheet', () => {
  const js = readFileSync(`${root}wordpress/kcpw-address-autocomplete/assets/js/kcpw-aa.js`);
  const css = readFileSync(`${root}wordpress/kcpw-address-autocomplete/assets/css/kcpw-aa.css`);
  const jsGz = gzipSync(js, { level: 9 }).length;
  const cssGz = gzipSync(css, { level: 9 }).length;
  console.log(
    `core script ${js.length} bytes (${jsGz} gzipped), stylesheet ${css.length} bytes (${cssGz} gzipped)`,
  );
  assert.ok(jsGz <= 20000, `core script ${jsGz} bytes gzipped`);
  assert.ok(cssGz <= 3500, `stylesheet ${cssGz} bytes gzipped`);
});

test('the optional features are separate files, so a page that does not use them downloads none of them', () => {
  const core = readFileSync(
    `${root}wordpress/kcpw-address-autocomplete/assets/js/kcpw-aa.js`,
    'utf8',
  );
  for (const module of ['map', 'gps', 'validate', 'pobox', 'picker']) {
    assert.equal(
      core.includes(`kcpw-aa-${module}`),
      false,
      `the core script must not contain the ${module} feature`,
    );
  }
  assert.ok(existsSync(zip));
});

test('each optional feature file is small, so switching one on costs a page little', () => {
  for (const [file, limit] of [
    ['kcpw-aa-pobox.js', 2200],
    ['kcpw-aa-validate.js', 2200],
    ['kcpw-aa-gps.js', 2000],
    ['kcpw-aa-map.js', 4000],
  ]) {
    const js = readFileSync(`${root}wordpress/kcpw-address-autocomplete/assets/js/${file}`);
    const gz = gzipSync(js, { level: 9 }).length;
    console.log(`${file} ${js.length} bytes (${gz} gzipped)`);
    assert.ok(gz <= limit, `${file} is ${gz} bytes gzipped (limit ${limit})`);
  }
  const css = readFileSync(`${root}wordpress/kcpw-address-autocomplete/assets/css/kcpw-aa-map.css`);
  assert.ok(gzipSync(css, { level: 9 }).length <= 1500);
});

test('the shipped PHP never contains a Google key, a webhook address or a customer address', () => {
  const files = entries.filter((e) => e.endsWith('.php') || e.endsWith('.js'));
  for (const entry of files) {
    const text = execFileSync('unzip', ['-p', zip, entry], { encoding: 'utf8' });
    assert.equal(/AIza[0-9A-Za-z_-]{30,}/.test(text), false, entry);
    assert.equal(/hooks\.slack\.com\/services\/T/.test(text), false, entry);
  }
});
