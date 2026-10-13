import { expect, test } from '@playwright/test';

const widths = [320, 375, 768, 1280];
const pages = ['/', '/shop/', '/product/sample-custom-poster/', '/cart/'];

test.describe('responsive layout', () => {
  for (const width of widths) {
    for (const path of pages) {
      test(`no horizontal scroll at ${width}px: ${path}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe('navigation and keyboard', () => {
  test('skip link is the first tab stop and moves focus to main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('a product card has one tab stop and opens its product', async ({ page }) => {
    await page.goto('/shop/');
    const card = page.locator('article.card').first();
    await expect(card.getByRole('link')).toHaveCount(1);
    await card.getByRole('link').click();
    await expect(page).toHaveURL(/\/product\/sample-personalized-print\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Personalized Print');
  });

  test('unknown routes return the 404 page', async ({ page }) => {
    const response = await page.goto('/nope/');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('indexing and headers (non-production build)', () => {
  test('non-production responses are noindex and robots.txt disallows everything', async ({
    request,
  }) => {
    const home = await request.get('/');
    expect(home.headers()['x-robots-tag']).toContain('noindex');
    expect(home.headers()['x-frame-options']).toBe('DENY');
    expect(home.headers()['x-content-type-options']).toBe('nosniff');
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/Disallow: \//);
  });

  test('product pages expose structured data and a canonical URL', async ({ page }) => {
    await page.goto('/product/sample-personalized-print/');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = ld.map((t) => JSON.parse(t)['@type']);
    expect(types).toEqual(expect.arrayContaining(['Product', 'BreadcrumbList']));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/product\/sample-personalized-print\/$/,
    );
  });

  test('the quote endpoint rejects a client-supplied price', async ({ request }) => {
    const res = await request.post('/api/cart/quote/', {
      data: { lines: [{ productId: 103, quantity: 1, options: {}, price: 1 }] },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('home page photo banner', () => {
  test('headline, copy, and both buttons are real, reachable text over the photo', async ({
    page,
  }) => {
    await page.goto('/');
    const hero = page.getByRole('region', { name: /Michigan Made/ });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Michigan Made. Printed to Last.',
    );
    await expect(hero).toContainText('designed and 3D printed with care in Michigan');
    await expect(hero.getByRole('link', { name: /Shop now/ })).toHaveAttribute('href', '/shop/');
    await expect(hero.getByRole('link', { name: 'Our Story' })).toHaveAttribute('href', '/about/');
    // The photograph is decorative because all of its message is in the text.
    await expect(hero.getByRole('img')).toHaveCount(0);
  });

  test('"Our Story" opens a page rather than a 404', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Our Story' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Our Story' })).toBeVisible();
  });
});
