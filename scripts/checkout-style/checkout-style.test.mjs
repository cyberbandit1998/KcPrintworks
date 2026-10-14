import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const cssPath = resolve(root, 'wordpress/kcpw-checkout-style/assets/checkout.css');
const css = readFileSync(cssPath, 'utf8');

/** A small CSS reader: enough for this stylesheet (rules, @media / @container blocks, no nesting inside rules). */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}
function parseBlocks(text, atRule = null, out = []) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth += 1;
      if (text[j] === '}') depth -= 1;
      j += 1;
    }
    const body = text.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) {
      assert.ok(/^@(media|container)\b/.test(prelude), `unexpected at-rule: ${prelude}`);
      parseBlocks(body, prelude, out);
    } else {
      const declarations = splitTop(body, ';').map((d) => {
        const colon = d.indexOf(':');
        return { property: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() };
      });
      out.push({ selectors: splitTop(prelude, ','), declarations, atRule });
    }
    i = j;
  }
  return out;
}
const rules = parseBlocks(stripComments(css));

test('the stylesheet is not empty and is small enough to be fast (raw size, before gzip)', () => {
  assert.ok(rules.length > 40, `only ${rules.length} rules`);
  assert.ok(statSync(cssPath).size < 20_000, `checkout.css is ${statSync(cssPath).size} bytes`);
});

test('every selector is scoped to body.kcpw-checkout, the class added only on the checkout page', () => {
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      assert.ok(
        selector === 'body.kcpw-checkout' || /^body\.kcpw-checkout[\s:]/.test(selector),
        `not scoped: ${selector}`,
      );
    }
  }
});

test('nothing is requested from anywhere: no @import, url(), fonts, scripts or legacy hooks', () => {
  const bare = stripComments(css);
  for (const forbidden of [
    '@import',
    'url(',
    '@font-face',
    'expression(',
    'behavior:',
    '-moz-binding',
    'javascript:',
    '<script',
  ]) {
    assert.equal(bare.includes(forbidden), false, `contains ${forbidden}`);
  }
});

test('no rule reaches into a payment frame, and payment-related rules set only colors, border color and radius', () => {
  const PAYMENT =
    /(payment|express|gateway|stripe|paypal|ppcp|accordion|radio-control|card-element|iframe|embed|object)/i;
  const ALLOWED = new Set([
    'color',
    'background',
    'background-color',
    'border-color',
    'border-radius',
  ]);
  let checked = 0;
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      assert.equal(/(iframe|embed|object)/i.test(selector), false, `targets a frame: ${selector}`);
      if (!PAYMENT.test(selector)) continue;
      checked += 1;
      for (const { property } of rule.declarations) {
        assert.ok(
          ALLOWED.has(property),
          `${selector} sets ${property}, which could change how a payment element is drawn or measured`,
        );
      }
    }
  }
  assert.ok(checked >= 4, 'the payment-method rules exist (and are the ones being checked)');
});

test("size, position, overflow, stacking and visibility are only ever set on the plugin's own header", () => {
  const GEOMETRY = new Set([
    'position',
    'overflow',
    'overflow-x',
    'overflow-y',
    'z-index',
    'transform',
    'filter',
    'contain',
    'container-type',
    'pointer-events',
    'visibility',
    'opacity',
    'clip',
    'clip-path',
    'inset',
    'top',
    'left',
    'right',
    'bottom',
  ]);
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      for (const { property } of rule.declarations) {
        if (GEOMETRY.has(property)) {
          assert.ok(selector.includes('kcpw-co-'), `${selector} sets ${property}`);
        }
      }
    }
  }
});

test('display is changed on exactly two things: the plugin\'s own header parts and WooCommerce\'s redundant "Return to Cart" link', () => {
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      for (const { property, value } of rule.declarations) {
        if (property !== 'display') continue;
        const ours = selector.includes('kcpw-co-');
        const returnLink =
          selector === 'body.kcpw-checkout .wc-block-components-checkout-return-to-cart-button' &&
          /^none\b/.test(value);
        assert.ok(ours || returnLink, `${selector} sets display: ${value}`);
      }
    }
  }
});

test("every custom property that is used is defined, and the colors are the storefront's own", () => {
  const defined = new Map();
  for (const rule of rules) {
    if (rule.selectors.length === 1 && rule.selectors[0] === 'body.kcpw-checkout') {
      for (const { property, value } of rule.declarations)
        if (property.startsWith('--')) defined.set(property, value);
    }
  }
  for (const match of css.matchAll(/var\((--kcpw-[a-z-]+)/g)) {
    assert.ok(defined.has(match[1]), `${match[1]} is used but not defined`);
  }
  const tokens = readFileSync(resolve(root, 'apps/storefront/src/styles/tokens.css'), 'utf8');
  const storefront = (name) =>
    new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1]?.toLowerCase();
  const pairs = {
    '--kcpw-bg': '--kc-bg',
    '--kcpw-ink': '--kc-ink',
    '--kcpw-accent': '--kc-accent',
    '--kcpw-link': '--kc-link',
    '--kcpw-surface': '--kc-surface',
    '--kcpw-muted': '--kc-muted',
    '--kcpw-link-strong': '--kc-link-strong',
    '--kcpw-error': '--kc-error',
    '--kcpw-success': '--kc-success',
    '--kcpw-rule': '--kc-rule',
  };
  for (const [ours, theirs] of Object.entries(pairs)) {
    assert.equal(
      defined.get(ours)?.toLowerCase(),
      storefront(theirs),
      `${ours} must equal the storefront's ${theirs}`,
    );
  }
  assert.equal(storefront('--kc-bg'), '#f3ebdd');
  assert.equal(storefront('--kc-accent'), '#ff4a24');
});

// ---- WCAG 2 contrast for every foreground and background the stylesheet pairs ----
const hexOf = (name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)[1];
const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const c = {
  bg: hexOf('--kcpw-bg'),
  ink: hexOf('--kcpw-ink'),
  accent: hexOf('--kcpw-accent'),
  link: hexOf('--kcpw-link'),
  surface: hexOf('--kcpw-surface'),
  muted: hexOf('--kcpw-muted'),
  linkStrong: hexOf('--kcpw-link-strong'),
  error: hexOf('--kcpw-error'),
  success: hexOf('--kcpw-success'),
};

test('text pairings meet WCAG 2.2 AA (4.5:1)', () => {
  const text = [
    ['ink on cream (page)', c.ink, c.bg],
    ['ink on paper (fields, summary)', c.ink, c.surface],
    ['muted on cream (header label, hints)', c.muted, c.bg],
    ['muted on paper (labels, details)', c.muted, c.surface],
    ['link on cream', c.link, c.bg],
    ['link on paper', c.link, c.surface],
    ['link hover on cream', c.linkStrong, c.bg],
    ['link hover on paper', c.linkStrong, c.surface],
    ['error text on cream', c.error, c.bg],
    ['error text on paper', c.error, c.surface],
    ['dark ink on the orange button', c.ink, c.accent],
    ['cream on ink (hover, footer, quantity badge)', c.bg, c.ink],
    ['muted on paper (disabled button)', c.muted, c.surface],
  ];
  for (const [name, fg, bg] of text) {
    assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${contrast(fg, bg).toFixed(2)}:1`);
  }
});

test('control boundaries and focus rings meet 3:1, and the orange is never used as text or as a lone boundary', () => {
  for (const [name, fg, bg] of [
    ['ink border on cream', c.ink, c.bg],
    ['ink border on paper', c.ink, c.surface],
    ['error border on paper', c.error, c.surface],
    ['success border on paper', c.success, c.surface],
    ['ink focus ring on cream', c.ink, c.bg],
    ['cream focus ring on the ink footer', c.bg, c.ink],
  ]) {
    assert.ok(contrast(fg, bg) >= 3, `${name}: ${contrast(fg, bg).toFixed(2)}:1`);
  }
  assert.ok(
    contrast(c.accent, c.bg) < 3,
    'orange on cream is below 3:1, so it must not carry meaning alone',
  );
  for (const rule of rules) {
    for (const { property, value } of rule.declarations) {
      if (value.includes('--kcpw-accent')) {
        assert.ok(
          property === 'background' ||
            property === 'background-color' ||
            property === '--kcpw-accent',
          `orange used for ${property} in ${rule.selectors[0]}`,
        );
      }
    }
  }
});

test('every interactive state keeps a visible focus ring', () => {
  const focus = rules.filter((r) => r.selectors.some((s) => s.includes(':focus-visible')));
  assert.ok(focus.length >= 3, 'focus rules exist for the page, the buttons and the footer');
  for (const rule of focus) {
    const outline = rule.declarations.find(
      (d) => d.property === 'outline' || d.property === 'outline-color',
    );
    assert.ok(outline, `${rule.selectors[0]} has no outline`);
    if (outline.property === 'outline') assert.match(outline.value, /^3px solid /);
  }
});
