// Tests for the optional feature scripts of the address autocomplete plugin (wordpress/kcpw-address-autocomplete/assets/js/kcpw-aa-*.js):
// the PO box rules are run against the SAME vectors as the PHP class, and the Geocoder-answer helpers shared by "use my location" and the map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../../wordpress/kcpw-address-autocomplete/', import.meta.url);
const load = (name) => require(new URL(`assets/js/${name}`, root).pathname);
const pobox = load('kcpw-aa-pobox.js');
const gps = load('kcpw-aa-gps.js');
const map = load('kcpw-aa-map.js');
const validate = load('kcpw-aa-validate.js');
const vectors = JSON.parse(readFileSync(new URL('tests/vectors/pobox.json', root), 'utf8'));

test('the PO box vectors are numerous enough to mean something', () => {
  assert.ok(vectors.cases.length >= 30);
  assert.ok(vectors.cases.some((c) => c.expect === 'military'));
  assert.ok(vectors.cases.some((c) => c.expect === null));
});

for (const c of vectors.cases) {
  test(`PO box rules (same vectors as PHP): "${c.text}" is ${c.expect}`, () => {
    assert.equal(pobox.detect(c.text), c.expect);
  });
}

test('PO box: any line counts, the first finding wins, and hostile input never throws', () => {
  assert.equal(pobox.detectAny(['Apt 4', 'PO Box 12']), 'po_box');
  assert.equal(pobox.detectAny(['12 Main Street', 'Suite 4']), null);
  assert.equal(pobox.detectAny([]), null);
  for (const text of [undefined, null, 5, {}, '', '\0\0', 'PO '.repeat(5000), '<script>']) {
    pobox.detect(text);
  }
});

test('PO box: a long run of near-matches stays fast (no pathological pattern)', () => {
  const started = Date.now();
  pobox.detect(('APO ' + 'a '.repeat(20)).repeat(500));
  pobox.detect('p o b '.repeat(5000));
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});

test('the Geocoder answer is converted to the shape the address mapper reads', () => {
  const converted = gps.toComponents([
    { types: ['locality'], long_name: 'Flint', short_name: 'Flint' },
    { types: ['country'], long_name: 'United States', short_name: 'US' },
  ]);
  assert.deepEqual(converted, [
    { types: ['locality'], longText: 'Flint', shortText: 'Flint' },
    { types: ['country'], longText: 'United States', shortText: 'US' },
  ]);
  assert.deepEqual(gps.toComponents(undefined), []);
  assert.deepEqual(map.toComponents(null), []);
});

test('only a result that names a street, a building or a route counts as an address', () => {
  const town = { types: ['locality'], formatted_address: 'Flint' };
  const route = { types: ['route'], formatted_address: 'Main St' };
  const street = { types: ['street_address'], formatted_address: '123 Main St' };
  assert.equal(gps.pick([town]), null);
  assert.equal(gps.pick([]), null);
  assert.equal(gps.pick(undefined), null);
  assert.equal(gps.pick([town, route]), route);
  assert.equal(gps.pick([route, street]), street, 'the most specific result is preferred');
  assert.equal(map.pick([route, street]), street);
});

test('the address check sends only address parts, needs a street, a country and a town or postal code', () => {
  const fields = {
    address: { value: '123 Main Street' },
    address2: { value: 'Apt 4' },
    city: { value: 'Flint' },
    state: { value: 'MI' },
    postcode: { value: '48502' },
    country: { value: 'us' },
    name: { value: 'Should never be read' },
  };
  const ctx = {
    fieldEl: (name) => fields[name] ?? null,
    form: { id: 'f_abc12345', countries: ['US', 'CA'] },
  };
  assert.deepEqual(validate.gather(ctx), {
    regionCode: 'US',
    postalCode: '48502',
    administrativeArea: 'MI',
    locality: 'Flint',
    addressLines: ['123 Main Street', 'Apt 4'],
    formId: 'f_abc12345',
  });
  assert.equal(JSON.stringify(validate.gather(ctx)).includes('Should never'), false);
  assert.equal(
    validate.gather({ ...ctx, fieldEl: (n) => (n === 'address' ? { value: '12' } : fields[n]) }),
    null,
  );
  assert.equal(
    validate.gather({ ...ctx, fieldEl: (n) => (n === 'country' ? { value: '' } : fields[n]) })
      ?.regionCode,
    undefined,
    'a form with two countries cannot guess the one',
  );
  assert.equal(
    validate.gather({
      ...ctx,
      form: { id: 'f_x1234', countries: ['CA'] },
      fieldEl: (n) => (n === 'country' ? { value: '' } : fields[n]),
    })?.regionCode,
    'CA',
    'a form that ships to one country knows it',
  );
  assert.equal(
    validate.gather({
      ...ctx,
      fieldEl: (n) => (n === 'city' || n === 'postcode' ? { value: '' } : fields[n]),
    }),
    null,
  );
});

test('every optional feature registers under the name the plugin configuration uses', () => {
  const names = readdirSync(new URL('assets/js/', root)).filter((f) =>
    /^kcpw-aa-(pobox|validate|gps|map)\.js$/.test(f),
  );
  assert.equal(names.length, 4);
  const seen = {};
  const KCPWAA = { registerModule: (id) => (seen[id] = true) };
  globalThis.document = { currentScript: null };
  for (const name of names) {
    const source = readFileSync(new URL(`assets/js/${name}`, root), 'utf8');
    new Function('window', 'module', 'document', `(function(){${source}}).call(window)`)(
      { KCPWAA, document: globalThis.document },
      undefined,
      globalThis.document,
    );
  }
  assert.deepEqual(Object.keys(seen).sort(), ['gps', 'map_picker', 'pobox', 'validation']);
  delete globalThis.document;
});

test('no optional feature script holds a Google key, an address of this site or a request to anywhere but Google or the configured routes', () => {
  for (const name of ['pobox', 'validate', 'gps', 'map']) {
    const source = readFileSync(new URL(`assets/js/kcpw-aa-${name}.js`, root), 'utf8');
    assert.equal(/AIza[0-9A-Za-z_-]{30,}/.test(source), false, name);
    assert.equal(
      /https?:\/\/(?!www\.w3\.org)/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
      false,
      `${name} names an outside address`,
    );
    assert.equal(
      /\bXMLHttpRequest\b|\bfetch\(|sendBeacon/.test(source),
      false,
      `${name} makes its own network request`,
    );
  }
});
