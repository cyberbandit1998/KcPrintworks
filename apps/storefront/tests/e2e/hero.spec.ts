import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The home page photo banner: the owner's workshop photograph (public/images/kcprintworks-hero.webp, with a phone crop of the same
 * picture) full width behind real text, under a dark gradient that is strongest on the left. Measured in a real browser,
 * including the rendered pixels.
 */

const WARM_WHITE = 'rgb(243, 235, 221)'; // #F3EBDD
const ORANGE = 'rgb(255, 74, 36)'; // #FF4A24
const INK = 'rgb(17, 18, 22)'; // #111216

const box = async (page: Page, selector: string) =>
  (await page.locator(selector).first().boundingBox())!;

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>('.hero__photo img');
    return !!img && img.complete && img.naturalWidth > 0;
  });
}

/** Mean brightness (0 to 255) of a rectangle of the banner as it is actually painted, given as fractions of its size. */
async function brightness(
  page: Page,
  area: { x0: number; x1: number; y0: number; y1: number },
): Promise<number> {
  const png = (await page.locator('.hero').screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, area }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const x = Math.floor(area.x0 * image.width);
      const y = Math.floor(area.y0 * image.height);
      const w = Math.max(1, Math.floor((area.x1 - area.x0) * image.width));
      const h = Math.max(1, Math.floor((area.y1 - area.y0) * image.height));
      const data = context.getImageData(x, y, w, h).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      }
      return sum / (data.length / 4);
    },
    { png, area },
  );
}

test.describe('desktop banner', () => {
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    test(`${width}px: full width, 430 to 500px tall, photo covering it, text left and vertically centered`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await ready(page);
      const hero = await box(page, '.hero');
      expect(hero.x).toBe(0);
      expect(hero.width).toBe(width); // edge to edge: no gutter, no empty space on the right
      expect(hero.height).toBeGreaterThanOrEqual(430);
      expect(hero.height).toBeLessThanOrEqual(500);

      const photo = await box(page, '.hero__photo');
      expect(Math.abs(photo.x - hero.x)).toBeLessThan(1);
      expect(Math.abs(photo.y - hero.y)).toBeLessThan(1);
      expect(Math.abs(photo.width - hero.width)).toBeLessThan(1);
      expect(Math.abs(photo.height - hero.height)).toBeLessThan(1);
      expect(
        await page.locator('.hero__photo img').evaluate((el) => getComputedStyle(el).objectFit),
      ).toBe('cover');
      // The desktop picture is the wide crop, not the phone one.
      const shown = await page
        .locator('.hero__photo img')
        .evaluate((el) => (el as HTMLImageElement).currentSrc);
      expect(decodeURIComponent(shown)).toContain('kcprintworks-hero.webp');
      expect(decodeURIComponent(shown)).not.toContain('-mobile');

      const text = await box(page, '.hero__text');
      expect(text.x + text.width).toBeLessThan(width * 0.6); // on the left, the right is left to the photo
      expect(text.x + text.width / 2).toBeLessThan(width * 0.45);
      expect(Math.abs(text.y + text.height / 2 - (hero.y + hero.height / 2))).toBeLessThan(12);
      // Nothing spills past the page.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }

  test('headline: exactly "Michigan Made. Printed to Last." on two lines, "Printed" in orange, the rest warm white, bold', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveText('Michigan Made. Printed to Last.');
    const lines = page.locator('.hero__line');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveText('Michigan Made.');
    await expect(lines.nth(1)).toHaveText('Printed to Last.');
    const [first, second] = [await lines.nth(0).boundingBox(), await lines.nth(1).boundingBox()];
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height * 0.8); // really two lines
    expect(Math.abs(second!.x - first!.x)).toBeLessThan(1);

    const style = await page.evaluate(() => {
      const css = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return {
        h1: css('.hero h1').color,
        accent: css('.hero__accent').color,
        weight: Number(css('.hero h1').fontWeight),
        size: parseFloat(css('.hero h1').fontSize),
        lead: css('.hero__lead').color,
        accentText: document.querySelector('.hero__accent')!.textContent,
      };
    });
    expect(style).toMatchObject({
      h1: WARM_WHITE,
      accent: ORANGE,
      lead: WARM_WHITE,
      accentText: 'Printed',
    });
    expect(style.weight).toBeGreaterThanOrEqual(800);
    expect(style.size).toBeGreaterThanOrEqual(56);
    await expect(page.locator('.hero__lead')).toHaveText(
      'Game cases, gifts, desk gear & more — designed and 3D printed with care in Michigan.',
    );
  });

  test('buttons: "Shop Now" solid orange with near-black text; "Our Story" transparent with a warm-white border and text', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    const hero = page.getByRole('region', { name: /Michigan Made/ });
    const shop = hero.getByRole('link', { name: 'Shop Now', exact: true });
    const story = hero.getByRole('link', { name: 'Our Story', exact: true });
    await expect(shop).toHaveAttribute('href', '/shop/');
    await expect(story).toHaveAttribute('href', '/about/');
    const paint = (locator: typeof shop) =>
      locator.evaluate((el) => {
        const s = getComputedStyle(el);
        return { background: s.backgroundColor, color: s.color, border: s.borderTopColor };
      });
    expect(await paint(shop)).toMatchObject({ background: ORANGE, color: INK });
    expect(await paint(story)).toEqual({
      background: 'rgba(0, 0, 0, 0)', // transparent
      color: WARM_WHITE,
      border: WARM_WHITE,
    });
    // Side by side, on the left under the copy.
    const [a, b] = [(await shop.boundingBox())!, (await story.boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(a.x).toBeLessThan(b.x);
  });

  test('the overlay is darkest on the left and fades to the right, so the printers stay visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    const gradient = await page
      .locator('.hero')
      .evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
    expect(gradient).toContain('linear-gradient');
    // The rendered pixels: the left edge (left of any text) against the printers, which stand right of centre.
    const left = await brightness(page, { x0: 0, x1: 0.03, y0: 0, y1: 1 });
    const printers = await brightness(page, { x0: 0.66, x1: 0.9, y0: 0.15, y1: 0.95 });
    expect(left).toBeLessThan(45);
    expect(printers).toBeGreaterThan(left + 30);
    expect(printers).toBeGreaterThan(55);
    await page.locator('.hero').screenshot({ path: 'test-results/hero-1440.png' });
  });

  test('keeps the navigation: paper background, logo, links and cart', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    // The header is transparent over the page, so what a visitor sees is the first painted background behind it.
    const painted = await page.locator('.site-header').evaluate((el) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      }
      return 'none';
    });
    expect(painted).toBe(WARM_WHITE);
    await expect(page.locator('.site-header .brand')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.locator('.cart-link')).toBeVisible();
    const header = await box(page, '.site-header');
    const hero = await box(page, '.hero');
    expect(Math.abs(hero.y - (header.y + header.height))).toBeLessThan(2); // the banner starts right under it
  });
});

test.describe('tablet banner', () => {
  for (const width of [768, 1024]) {
    test(`${width}px: two lines, inside the page, 430 to 500px tall`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await ready(page);
      const hero = await box(page, '.hero');
      expect(hero.width).toBe(width);
      expect(hero.height).toBeGreaterThanOrEqual(430);
      expect(hero.height).toBeLessThanOrEqual(500);
      const second = (await page.locator('.hero__line').nth(1).boundingBox())!;
      expect(second.x + second.width).toBeLessThanOrEqual(width - 16);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('mobile banner', () => {
  for (const width of [320, 360, 390, 414]) {
    test(`${width}px: readable text, buttons that fit, no sideways scrolling, and a strip of photo kept for the printers`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await ready(page);
      const hero = await box(page, '.hero');
      expect(hero.width).toBe(width);
      expect(hero.height).toBeGreaterThanOrEqual(480);
      expect(hero.height).toBeLessThanOrEqual(760);

      const m = await page.evaluate(() => {
        const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const lines = [...document.querySelectorAll<HTMLElement>('.hero__line')];
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clipped: lines.some((l) => l.scrollWidth > l.clientWidth),
          headingRight: Math.max(...lines.map((l) => l.getBoundingClientRect().right)),
          headingSize: parseFloat(getComputedStyle(document.querySelector('.hero h1')!).fontSize),
          leadSize: parseFloat(getComputedStyle(document.querySelector('.hero__lead')!).fontSize),
          buttons: [...document.querySelectorAll('.hero__actions .button')].map((b) => {
            const r = b.getBoundingClientRect();
            return { left: r.left, right: r.right, height: r.height, bottom: r.bottom };
          }),
          heroBottom: rect('.hero').bottom,
          first: rect('.hero__line').top,
          heroTop: rect('.hero').top,
        };
      });
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(m.clipped).toBe(false);
      expect(m.headingRight).toBeLessThanOrEqual(width - 8);
      expect(m.headingSize).toBeGreaterThanOrEqual(28);
      expect(m.leadSize).toBeGreaterThanOrEqual(16);
      for (const b of m.buttons) {
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(width);
        expect(b.height).toBeGreaterThanOrEqual(44);
      }
      // The photo is anchored to the bottom of the banner, with plain dark above it for the text.
      const photo = await box(page, '.hero__photo');
      expect(Math.abs(photo.y + photo.height - (hero.y + hero.height))).toBeLessThan(1);
      expect(photo.height).toBeLessThan(hero.height * 0.7);
      // The photo keeps its own strip below the text, with the gradient fading into it.
      const lowest = Math.max(...m.buttons.map((b) => b.bottom));
      expect(m.heroBottom - lowest).toBeGreaterThanOrEqual(160);
      // ... and it is really brighter there than behind the text (the printers show).
      const darkAbove = await brightness(page, { x0: 0, x1: 1, y0: 0, y1: 0.03 }); // plain dark above the headline
      const photoStrip = await brightness(page, { x0: 0, x1: 1, y0: 0.88, y1: 1 });
      expect(photoStrip).toBeGreaterThan(darkAbove + 20);
      expect(photoStrip).toBeGreaterThan(40);
      await page.locator('.hero').screenshot({ path: `test-results/hero-${width}.png` });
    });
  }
});

test.describe('performance and accessibility', () => {
  test('the photo is the high-priority image: fetched first, never lazy, resized per screen, and small', async ({
    page,
  }) => {
    const sizes: { url: string; bytes: number; type: string }[] = [];
    page.on('response', async (response) => {
      if (response.url().includes('/_next/image') && response.url().includes('kcprintworks-hero')) {
        sizes.push({
          url: decodeURIComponent(response.url()),
          bytes: (await response.body()).length,
          type: response.headers()['content-type'] ?? '',
        });
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page);
    const photo = page.locator('.hero__photo img');
    await expect(photo).toHaveAttribute('fetchpriority', 'high');
    expect(await photo.getAttribute('loading')).not.toBe('lazy');
    expect(await photo.getAttribute('alt')).toBe(''); // decorative: all of its message is in the text
    expect(await photo.getAttribute('srcset')).toContain('kcprintworks-hero-mobile');
    const source = page.locator('.hero__photo source');
    await expect(source).toHaveAttribute('media', '(min-width: 40em)');
    expect(await source.getAttribute('srcset')).toContain('kcprintworks-hero.webp');
    expect(await source.getAttribute('sizes')).toBe('100vw');
    // The whole page needs one hero image, in a modern format, well under half a megabyte.
    const wide = sizes.filter((s) => !s.url.includes('-mobile'));
    expect(wide.length).toBeGreaterThan(0);
    expect(sizes.some((s) => s.url.includes('-mobile'))).toBe(false); // a desktop never fetches the phone crop
    for (const s of wide) {
      expect(s.type).toMatch(/^image\//);
      expect(s.bytes, s.url).toBeLessThan(350_000);
    }
  });

  test('a phone fetches only its own crop of the photo, and it is smaller still', async ({
    page,
  }) => {
    const sizes: { url: string; bytes: number }[] = [];
    page.on('response', async (response) => {
      if (response.url().includes('/_next/image') && response.url().includes('kcprintworks-hero')) {
        sizes.push({
          url: decodeURIComponent(response.url()),
          bytes: (await response.body()).length,
        });
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    const shown = await page
      .locator('.hero__photo img')
      .evaluate((el) => (el as HTMLImageElement).currentSrc);
    expect(decodeURIComponent(shown)).toContain('kcprintworks-hero-mobile');
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((s) => s.url.includes('-mobile'))).toBe(true);
    for (const s of sizes) expect(s.bytes, s.url).toBeLessThan(200_000);
  });

  test('largest contentful paint is quick on this machine', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __lcp: number }).__lcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as unknown as { __lcp: number }).__lcp = entry.startTime;
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.setViewportSize({ width: 390, height: 800 });
    await ready(page);
    await page.waitForTimeout(500);
    const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(2500);
  });

  test('has no WCAG 2.2 AA violations on desktop and phone', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await ready(page);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        `${viewport.width}px`,
      ).toEqual([]);
    }
  });
});
