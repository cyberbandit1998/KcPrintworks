// The address autocomplete stylesheet: scoping, no outside requests, the Google attribution cannot be hidden, and WCAG AA contrast
// for the light and dark list and for the administrator notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../wordpress/kcpw-address-autocomplete/', import.meta.url);
const css = readFileSync(new URL('assets/css/kcpw-aa.css', root), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

test('every selector belongs to the plugin (starts with .kcpw-aa-)', () => {
  for (const r of rules(stripped)) {
    if (r.selector.startsWith('@') || /^(from|to|\d+%)$/.test(r.selector)) continue;
    for (const part of r.selector.split(',').map((s) => s.trim())) {
      assert.ok(part.startsWith('.kcpw-aa-'), `selector "${part}" is not scoped`);
    }
  }
});

test('nothing is requested from anywhere: no url(), no @import, no !important', () => {
  assert.equal(/url\(/i.test(stripped), false);
  assert.equal(/@import/i.test(stripped), false);
  assert.equal(/!important/.test(stripped), false);
});

test('the Google attribution is never hidden, clipped or made transparent', () => {
  for (const r of rules(stripped)) {
    if (!r.selector.includes('kcpw-aa-attrib')) continue;
    assert.equal(
      /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size\s*:\s*0|clip|height\s*:\s*0/.test(
        r.body,
      ),
      false,
      r.selector,
    );
  }
  assert.ok(/\.kcpw-aa-attrib\s*\{/.test(stripped));
});

function vars(block) {
  const out = {};
  for (const m of block.matchAll(/--kcpw-aa-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g))
    out[m[1]] = m[2];
  return out;
}
function hex(value) {
  let v = value.replace('#', '');
  if (v.length === 3) v = [...v].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const light = vars(
  stripped.slice(stripped.indexOf('.kcpw-aa-dd {'), stripped.indexOf('.kcpw-aa-dd[hidden]')),
);
const dark = {
  ...light,
  ...vars(
    stripped.slice(
      stripped.indexOf(".kcpw-aa-dd[data-theme='dark']"),
      stripped.indexOf('.kcpw-aa-list'),
    ),
  ),
};

for (const [name, t] of [
  ['light', light],
  ['dark', dark],
]) {
  test(`${name} list: text pairs reach 4.5:1`, () => {
    for (const [fg, bg] of [
      ['fg', 'bg'],
      ['muted', 'bg'],
      ['attrib', 'bg'],
      ['fg', 'hover'],
      ['muted', 'hover'],
    ]) {
      assert.ok(
        ratio(t[fg], t[bg]) >= 4.5,
        `${name}: ${fg} on ${bg} is ${ratio(t[fg], t[bg]).toFixed(2)}`,
      );
    }
  });
}

test('the active-row bar (non-text) reaches 3:1 against the list in both themes, using the default highlight color', () => {
  assert.ok(ratio('#2b59e6', light.bg) >= 3, `light ${ratio('#2b59e6', light.bg).toFixed(2)}`);
  assert.ok(ratio(dark.mark, dark.bg) >= 3, `dark ${ratio(dark.mark, dark.bg).toFixed(2)}`);
});

test('the administrator notice has readable text in both colors', () => {
  assert.ok(ratio('#ffffff', '#1f2328') >= 4.5);
  assert.ok(ratio('#ffffff', '#7a1f1a') >= 4.5);
});

test('the list is at least 44px tall per row (touch targets) and respects reduced motion and forced colors', () => {
  assert.ok(/\.kcpw-aa-opt\s*\{[^}]*min-height:\s*44px/.test(stripped));
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(stripped));
  assert.ok(/forced-colors:\s*active/.test(stripped));
});

test('direction-neutral: the list uses logical properties for its sides', () => {
  assert.ok(/border-inline-start/.test(stripped));
  assert.equal(/margin-left|padding-left|border-left|text-align:\s*left/.test(stripped), false);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The optional features' styles: the notes under a field, the two buttons, and the map window (a separate stylesheet).
// ---------------------------------------------------------------------------------------------------------------------------------

function declared(text, selector, property) {
  const rule = rules(text).find((r) => r.selector === selector);
  assert.ok(rule, `no rule for ${selector}`);
  // A color property is `#hex`; the border shorthand is `1px solid #hex`.
  const value = property === 'border' ? '[^;#]*?(#[0-9a-fA-F]{3,6})' : '(#[0-9a-fA-F]{3,6})';
  const m = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*${value}\\s*;`).exec(rule.body);
  assert.ok(m, `${selector} has no ${property}`);
  return m[1];
}

test('every note carries its own text and background colors and reads at 4.5:1 on any page', () => {
  for (const sel of [
    '.kcpw-aa-note',
    ".kcpw-aa-note[data-kind='ok']",
    ".kcpw-aa-note[data-kind='warn']",
    ".kcpw-aa-note[data-kind='error']",
  ]) {
    const fg = declared(stripped, sel, 'color');
    const bg = declared(stripped, sel, 'background');
    assert.ok(ratio(fg, bg) >= 4.5, `${sel}: ${ratio(fg, bg).toFixed(2)}`);
  }
});

test('the note edge bar (non-text) reaches 3:1 against its note background', () => {
  for (const kind of ['ok', 'warn', 'error']) {
    const sel = `.kcpw-aa-note[data-kind='${kind}']`;
    const bar = declared(stripped, sel, 'border-inline-start-color');
    const bg = declared(stripped, sel, 'background');
    assert.ok(ratio(bar, bg) >= 3, `${kind}: ${ratio(bar, bg).toFixed(2)}`);
  }
});

test('the two buttons are at least 44px tall, use dark text on white, and show a focus ring', () => {
  assert.ok(/\.kcpw-aa-tool\s*\{[^}]*min-height:\s*44px/.test(stripped));
  assert.ok(
    ratio(
      declared(stripped, '.kcpw-aa-tool', 'color'),
      declared(stripped, '.kcpw-aa-tool', 'background'),
    ) >= 4.5,
  );
  assert.ok(/\.kcpw-aa-tool:focus-visible/.test(stripped));
  assert.ok(/\.kcpw-aa-tool:hover\s*\{[^}]*background/.test(stripped));
  const border = declared(stripped, '.kcpw-aa-tool', 'border');
  assert.ok(ratio(border, '#ffffff') >= 3, 'the button edge is visible');
});

const mapCss = readFileSync(new URL('assets/css/kcpw-aa-map.css', root), 'utf8');
const mapStripped = mapCss.replace(/\/\*[\s\S]*?\*\//g, '');

test('the map window stylesheet: every selector is its own, nothing is fetched, nothing is forced', () => {
  for (const r of rules(mapStripped)) {
    if (r.selector.startsWith('@')) continue;
    for (const part of r.selector.split(',').map((s) => s.trim())) {
      assert.ok(part.startsWith('.kcpw-aa-map'), `selector "${part}" is not scoped`);
    }
  }
  assert.equal(/url\(|@import|!important/i.test(mapStripped), false);
});

test('the map window: readable colors, 44px controls, a full-screen phone layout and forced-colors support', () => {
  const fg = declared(mapStripped, '.kcpw-aa-map', 'color');
  const bg = declared(mapStripped, '.kcpw-aa-map', 'background');
  assert.ok(ratio(fg, bg) >= 4.5);
  assert.ok(ratio(declared(mapStripped, '.kcpw-aa-map-help', 'color'), bg) >= 4.5);
  assert.ok(
    ratio(
      declared(mapStripped, '.kcpw-aa-map-btn', 'color'),
      declared(mapStripped, '.kcpw-aa-map-btn', 'background'),
    ) >= 4.5,
  );
  assert.ok(
    ratio(
      declared(mapStripped, '.kcpw-aa-map-use', 'color'),
      declared(mapStripped, '.kcpw-aa-map-use', 'background'),
    ) >= 4.5,
  );
  assert.ok(ratio(declared(mapStripped, '.kcpw-aa-map-btn', 'border'), '#ffffff') >= 3);
  assert.ok(
    /\.kcpw-aa-map-btn\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s.test(mapStripped),
  );
  assert.ok(/max-width:\s*480px/.test(mapStripped));
  assert.ok(/forced-colors:\s*active/.test(mapStripped));
  assert.equal(
    /margin-left|padding-left|border-left|text-align:\s*left/.test(mapStripped),
    false,
    'logical properties only',
  );
});
