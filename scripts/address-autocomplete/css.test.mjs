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
