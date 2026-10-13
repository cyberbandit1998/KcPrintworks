import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/a11y/contrast';

/**
 * Enforces ADR-011: the brand palette is unchanged, and every foreground/background pairing the components
 * can use meets WCAG 2.2 AA. This test reads the real tokens.css, so changing a color or a pairing there
 * without keeping it accessible fails the build.
 */

const stylesDir = join(__dirname, '../../src/styles');
const tokensCss = readFileSync(join(stylesDir, 'tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const raw: Record<string, string> = {};
for (const m of tokensCss.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
  if (m[1] && m[2]) raw[m[1]] = m[2].trim();
}

function resolve(name: string, depth = 0): string {
  if (depth > 10) throw new Error(`Token cycle at ${name}`);
  const value = raw[name];
  if (value === undefined) throw new Error(`Unknown token --${name}`);
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  return ref?.[1] ? resolve(ref[1], depth + 1) : value;
}

const hex = (token: string) => resolve(token).toLowerCase();

describe('brand palette', () => {
  it('keeps the four official brand colors exactly', () => {
    expect(hex('kc-bg')).toBe('#f3ebdd');
    expect(hex('kc-ink')).toBe('#111216');
    expect(hex('kc-accent')).toBe('#ff4a24');
    expect(hex('kc-link')).toBe('#2b59e6');
  });
});

describe('text pairings meet WCAG AA (4.5:1)', () => {
  const pairs: [string, string][] = [
    ['color-text', 'color-bg'],
    ['color-text', 'color-surface'],
    ['color-text-muted', 'color-bg'],
    ['color-text-muted', 'color-surface'],
    ['color-link', 'color-bg'],
    ['color-link', 'color-surface'],
    ['color-link-hover', 'color-bg'],
    ['color-link-hover', 'color-surface'],
    ['button-fg', 'button-bg'],
    ['button-hover-fg', 'button-hover-bg'],
    ['badge-fg', 'badge-bg'],
    ['color-text', 'accent-decor'], // brand mark and step numbers sit on orange
    ['footer-fg', 'footer-bg'],
    ['footer-link', 'footer-bg'],
    ['footer-muted', 'footer-bg'],
    ['footer-accent', 'footer-bg'],
    ['color-error', 'color-bg'],
    ['color-error', 'color-surface'],
    ['color-success', 'color-bg'],
    ['color-success', 'color-surface'],
  ];
  it.each(pairs)('%s on %s', (fg, bg) => {
    expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('non-text pairings meet 3:1', () => {
  const pairs: [string, string][] = [
    ['color-border-strong', 'color-bg'],
    ['color-border-strong', 'color-surface'],
    ['button-border', 'color-bg'],
    ['color-focus', 'color-bg'],
    ['color-focus', 'color-surface'],
    ['footer-focus', 'footer-bg'],
    ['color-error', 'color-bg'],
  ];
  it.each(pairs)('%s against %s', (fg, bg) => {
    expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('documented unsafe pairings stay unsafe (so the rules above keep their reason)', () => {
  it('white text on orange fails AA for normal text', () => {
    expect(contrastRatio('#ffffff', hex('kc-accent'))).toBeLessThan(4.5);
  });
  it('orange text on cream fails AA and the 3:1 boundary rule', () => {
    expect(contrastRatio(hex('kc-accent'), hex('kc-bg'))).toBeLessThan(3);
  });
  it('blue links on the dark footer fail AA', () => {
    expect(contrastRatio(hex('kc-link'), hex('kc-ink'))).toBeLessThan(4.5);
  });
});

describe('stylesheets', () => {
  const others = readdirSync(stylesDir).filter((f) => f.endsWith('.css') && f !== 'tokens.css');

  it.each(others)('%s uses semantic tokens only, never --kc-* brand tokens directly', (file) => {
    const css = readFileSync(join(stylesDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/var\(--kc-/);
  });

  it.each(others)('%s never uses decorative accent colors for text or control borders', (file) => {
    const css = readFileSync(join(stylesDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/(^|[;{\s])color\s*:\s*var\(--(accent|link)-decor\)/);
    expect(css).not.toMatch(/border(-color)?\s*:[^;]*var\(--(accent|link)-decor\)/);
  });
});
