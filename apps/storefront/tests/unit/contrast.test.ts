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
    ['hero-fg', 'hero-bg'],
    ['hero-accent', 'hero-bg'],
    ['hero-quote-fg', 'hero-bg'], // "Request a Custom Quote": white text on the dark side of the banner
    ['footer-fg', 'footer-bg'],
    ['footer-link', 'footer-bg'],
    ['footer-muted', 'footer-bg'],
    ['footer-accent', 'footer-bg'],
    ['color-error', 'color-bg'],
    ['color-error', 'color-surface'],
    ['color-success', 'color-bg'],
    ['color-success', 'color-surface'],
    ['progress-fg', 'progress-bg'], // free-shipping message and note on the paper card
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
    ['hero-focus', 'hero-bg'],
    ['hero-fg', 'hero-bg'], // the secondary button's border
    ['hero-quote-border', 'hero-bg'], // the orange outline of "Request a Custom Quote"
    ['color-error', 'color-bg'],
    ['progress-edge', 'progress-bg'], // the card's border and the bar's outline
    ['progress-edge', 'progress-track'], // the ink edge on the end of the fill, seen against the empty track
    ['progress-edge', 'progress-fill'], // ... and against the orange it closes
    ['progress-fill', 'progress-track'], // the filled part against the empty part (3.14:1)
    ['rating-edge', 'color-bg'], // the star outline on the page
    ['rating-edge', 'color-surface'], // ... and on a review card
    ['rating-edge', 'rating-fill'], // the outline against the filled part
    ['rating-edge', 'rating-empty'], // ... and against the empty part
  ];
  it.each(pairs)('%s against %s', (fg, bg) => {
    expect(contrastRatio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('photo banner text stays readable over any photograph', () => {
  // The scrim sits between the photo and the text. The worst photo pixel is white; mix it with the scrim.
  const strength = Number(/^(\d+(?:\.\d+)?)%$/.exec(resolve('hero-scrim'))?.[1]) / 100;
  const channels = (color: string) =>
    [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as [number, number, number];
  const mix = (scrim: string) =>
    '#' +
    channels(scrim)
      .map((c) =>
        Math.round(c * strength + 255 * (1 - strength))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  const worstCase = mix(hex('hero-bg'));

  it('has a scrim strong enough to be meaningful', () => {
    expect(strength).toBeGreaterThanOrEqual(0.75);
    expect(strength).toBeLessThanOrEqual(1);
  });
  it('body text (cream) is 4.5:1 or better even over a white pixel', () => {
    expect(contrastRatio(hex('hero-fg'), worstCase)).toBeGreaterThanOrEqual(4.5);
  });
  it('the orange headline word is 3:1 or better (large text) even over a white pixel', () => {
    expect(contrastRatio(hex('hero-accent'), worstCase)).toBeGreaterThanOrEqual(3);
  });
  it('the custom quote button: white text 4.5:1 and its orange outline 3:1 even over a white pixel, and the white text on the hover tint', () => {
    expect(contrastRatio(hex('hero-quote-fg'), worstCase)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex('hero-quote-border'), worstCase)).toBeGreaterThanOrEqual(3);
    // Hover: the inside takes 30% orange over the scrim. Worst case: 30% orange over the worst-case pixel.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex('hero-quote-border').slice(i, i + 2), 16));
    const [wr, wg, wb] = [1, 3, 5].map((i) => parseInt(worstCase.slice(i, i + 2), 16));
    const tint =
      '#' +
      [
        [r, wr],
        [g, wg],
        [b, wb],
      ]
        .map(([o, w]) =>
          Math.round(o! * 0.3 + w! * 0.7)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    expect(contrastRatio(hex('hero-quote-fg'), tint)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the photo banner overlay is a gradient: strongest on the left, fading toward the right', () => {
  const percent = (token: string) => Number(/^(\d+(?:\.\d+)?)%$/.exec(resolve(token))?.[1]) / 100;
  const heroCss = readFileSync(join(stylesDir, 'components.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('never gets lighter toward the right, and ends light enough for the printers to show', () => {
    const [start, floor, mid, end] = [
      'hero-scrim-start',
      'hero-scrim',
      'hero-scrim-mid',
      'hero-scrim-end',
    ].map(percent) as [number, number, number, number];
    expect(start).toBeGreaterThanOrEqual(floor);
    expect(floor).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(end);
    expect(start).toBeLessThanOrEqual(1);
    expect(floor).toBeGreaterThanOrEqual(0.8); // the least dark it may be behind text (white pixel: see below)
    expect(mid).toBeLessThanOrEqual(0.6);
    expect(end).toBeLessThanOrEqual(0.2);
  });

  it('is drawn left to right from those four tokens, in that order', () => {
    const rule = /\.hero::before\s*\{[^}]*\}/.exec(heroCss)?.[0] ?? '';
    expect(rule).toMatch(/linear-gradient\(\s*90deg/);
    const order = [
      'var(--hero-scrim-start)',
      'var(--hero-scrim)',
      'var(--hero-scrim-mid)',
      'var(--hero-scrim-end)',
    ].map((token) => rule.indexOf(token));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the whole banner in the page width: the photo box fills it and the picture covers the box', () => {
    expect(heroCss).toMatch(/\.hero__photo\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/);
    expect(heroCss).toMatch(/\.hero__photo img\s*\{[^}]*object-fit:\s*cover/);
  });
});

describe('documented unsafe pairings stay unsafe (so the rules above keep their reason)', () => {
  it('white text on orange fails AA for normal text', () => {
    expect(contrastRatio('#ffffff', hex('kc-accent'))).toBeLessThan(4.5);
  });
  it('orange text on cream fails AA and the 3:1 boundary rule', () => {
    expect(contrastRatio(hex('kc-accent'), hex('kc-bg'))).toBeLessThan(3);
  });
  it('orange directly on the paper background is too faint to be the only outline of the bar (so the ink outline stays)', () => {
    expect(contrastRatio(hex('progress-fill'), hex('progress-bg'))).toBeLessThan(3);
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
