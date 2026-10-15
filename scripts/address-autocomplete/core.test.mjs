// Tests for the pure helpers of the address autocomplete core script (wordpress/kcpw-address-autocomplete/assets/js/kcpw-aa.js):
// mapping Google's address parts to form fields, matching region/country options, sorting Google's errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../../wordpress/kcpw-address-autocomplete/', import.meta.url);
const core = require(new URL('assets/js/kcpw-aa.js', root).pathname);
const vectors = JSON.parse(
  readFileSync(new URL('tests/vectors/address-mapping.json', root), 'utf8'),
);

function components(parts, geocoder) {
  return parts.map(([type, long, short]) =>
    geocoder
      ? { types: [type], long_name: long, short_name: short ?? long }
      : { types: [type], longText: long, shortText: short ?? long },
  );
}

for (const c of vectors.cases) {
  test(`mapAddress: ${c.name}`, () => {
    const mapped = core.mapAddress(
      { components: components(c.parts, c.geocoder), formatted: c.formatted || '' },
      c.options,
    );
    const e = c.expect;
    if ('country' in e) assert.equal(mapped.country.code, e.country);
    if ('state' in e) assert.deepEqual([mapped.state.code, mapped.state.name], e.state);
    if ('city' in e) assert.equal(mapped.city, e.city);
    if ('postcode' in e) assert.equal(mapped.postcode, e.postcode);
    if ('line1' in e) assert.equal(mapped.line1, e.line1);
    if ('line2' in e) assert.equal(mapped.line2, e.line2);
  });
}

for (const o of vectors.options) {
  test(`matchOption: ${o.name}`, () => {
    const select = { options: o.list.map(([value, text]) => ({ value, text })) };
    const hit = core.matchOption(select, o.want);
    assert.equal(hit ? hit.value : null, o.expect);
  });
}

test('mapAddress returns coordinates only when given them', () => {
  const none = core.mapAddress({ components: [] });
  assert.equal(none.lat, null);
  const some = core.mapAddress({ components: [], lat: 43.1, lng: -83.5 });
  assert.deepEqual([some.lat, some.lng], [43.1, -83.5]);
});

test('mapAddress survives missing and hostile input', () => {
  for (const input of [
    undefined,
    null,
    {},
    { components: null },
    { components: [null, {}, { types: null }] },
  ]) {
    const mapped = core.mapAddress(input);
    assert.equal(mapped.line1, '');
    assert.equal(mapped.city, '');
  }
});

test('fold: accents, case, punctuation and county-style words disappear', () => {
  assert.equal(core.fold('São  Paulo!'), 'sao paulo');
  assert.equal(core.fold('County Dublin'), 'dublin');
  assert.equal(core.fold('Province of Ontario'), 'ontario');
  assert.equal(core.fold(null), '');
});

test('cacheKey: the same text typed with different spacing or case is one entry', () => {
  assert.equal(core.cacheKey('  123  Main St '), core.cacheKey('123 main st'));
});

const errors = [
  [
    'PERMISSION_DENIED: Places API (New) has not been used in project 1 before or it is disabled.',
    'api',
  ],
  ['REQUEST_DENIED', 'api'],
  ['ApiNotActivatedMapError', 'api'],
  ['InvalidKeyMapError', 'auth'],
  ['RefererNotAllowedMapError', 'auth'],
  ['The provided API key is invalid. API_KEY_INVALID', 'auth'],
  ['BillingNotEnabledMapError', 'billing'],
  ['RESOURCE_EXHAUSTED: Quota exceeded', 'quota'],
  ['OVER_QUERY_LIMIT', 'quota'],
  ['INVALID_ARGUMENT: bad type', 'request'],
  ['TypeError: Failed to fetch', 'network'],
  ['something odd', 'unknown'],
];
for (const [message, code] of errors) {
  test(`classifyError: ${message.slice(0, 40)} is ${code}`, () => {
    assert.equal(core.classifyError(new Error(message)), code);
  });
}

test('classifyError never throws on odd values', () => {
  for (const value of [undefined, null, 0, '', {}, [], 'x']) {
    assert.equal(core.classifyError(value), 'unknown');
  }
});

test("type filters: addresses use the three address types; cities and regions use Google's collections", () => {
  assert.deepEqual(core.TYPE_FILTERS.address, ['street_address', 'premise', 'subpremise']);
  assert.deepEqual(core.TYPE_FILTERS.cities, ['(cities)']);
  assert.deepEqual(core.TYPE_FILTERS.regions, ['(regions)']);
  assert.equal(
    core.TYPE_FILTERS.business,
    undefined,
    'businesses are filtered in the browser, not asked of Google',
  );
});

test("the script holds no key and no outside address other than Google's script", () => {
  const source = readFileSync(new URL('assets/js/kcpw-aa.js', root), 'utf8');
  assert.equal(/AIza[0-9A-Za-z_-]{30,}/.test(source), false);
  const hosts = [...source.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]);
  for (const host of hosts) assert.ok(host === 'https://maps.googleapis.com', host);
});
