import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Review display on the SAMPLE reviews (src/lib/reviews/fixture-client.ts): the sample card set has four (5, 4, 5, 4 = 4.5 average),
 * the sample sticker pack one, everything else none. The same pages reading the WooCommerce Store API stand-in, with awkward rows
 * and outages, are in woo-catalog.spec.ts.
 */

test('a rated product shows WooCommerce’s average and count, and links down to the reviews', async ({
  page,
}) => {
  await page.goto('/product/sample-card-set/');
  const summary = page.locator('.rating-summary a');
  await expect(summary).toContainText('4.5 out of 5 (4 reviews)');
  await expect(summary).toHaveAttribute('href', '#reviews');
  await summary.click();
  await expect(page.locator('#reviews')).toBeInViewport();
  await expect(page.getByRole('heading', { level: 2, name: 'Customer reviews' })).toBeVisible();
});

test('the reviews are the approved ones, newest first, each with its rating, date and "verified" only where marked', async ({
  page,
}) => {
  await page.goto('/product/sample-card-set/');
  const cards = page.locator('#reviews .review');
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toContainText('Sample A.');
  await expect(cards.first()).toContainText('October 12, 2026');
  await expect(cards.first().locator('.stars .visually-hidden')).toHaveText(
    'Rated 5 out of 5 stars',
  );
  await expect(cards.nth(1).locator('.stars .visually-hidden')).toHaveText(
    'Rated 4 out of 5 stars',
  );
  await expect(cards.locator('.badge', { hasText: 'Verified purchase' })).toHaveCount(2);
  await expect(cards.nth(1).locator('.badge')).toHaveCount(0);
  await expect(page.locator('#reviews .reviews__note')).toContainText(
    '4.5 out of 5, from 4 ratings',
  );
});

test('the product data carries the same rating and reviews, and nothing more', async ({ page }) => {
  await page.goto('/product/sample-card-set/');
  const ld = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((els) => els.map((el) => JSON.parse(el.textContent ?? '{}')));
  const product = ld.find((d) => d['@type'] === 'Product');
  expect(product.aggregateRating).toEqual({
    '@type': 'AggregateRating',
    ratingValue: 4.5,
    reviewCount: 4,
    bestRating: 5,
    worstRating: 1,
  });
  expect(product.review).toHaveLength(4);
  expect(product.review[0]).toMatchObject({
    '@type': 'Review',
    author: { '@type': 'Person', name: 'Sample A.' },
    reviewRating: { ratingValue: 5 },
  });
});

test('a product with no reviews says so, shows no rating, and puts none in its data', async ({
  page,
}) => {
  await page.goto('/product/sample-mug/');
  await expect(page.locator('.rating-summary')).toHaveCount(0);
  await expect(page.locator('#reviews')).toContainText('There are no reviews yet.');
  const text = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(text.join('').includes('aggregateRating')).toBe(false);
  expect(text.join('').includes('"Review"')).toBe(false);
});

test('the home page shows the newest reviews, each linked to its product, and no invented store rating', async ({
  page,
}) => {
  await page.goto('/');
  const section = page.locator('[data-section="reviews"]');
  await expect(section.getByRole('heading', { level: 2, name: 'Customer Reviews' })).toBeVisible();
  await expect(section.locator('.review')).toHaveCount(3);
  await expect(section.locator('.review').first()).toContainText('Sample A.');
  await expect(section.locator('.review a').first()).toHaveAttribute(
    'href',
    '/product/sample-card-set/',
  );
  const text = (await section.textContent()) ?? '';
  expect(/out of 5|average|rated \d/i.test(text.replace(/Rated \d out of 5 stars/g, ''))).toBe(
    false,
  );
  // Order on the page: products, then reviews, which is now the last section (Our Story and the blog are not on the home page).
  const order = await page
    .locator('main section[data-section]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
  expect(order.indexOf('reviews')).toBeGreaterThan(order.indexOf('new-arrivals'));
  expect(order.at(-1)).toBe('reviews');
});

test('review pages have no WCAG 2.2 AA violations, on a wide screen and a phone', async ({
  page,
}) => {
  for (const size of [
    { width: 1280, height: 900 },
    { width: 375, height: 800 },
  ]) {
    await page.setViewportSize(size);
    for (const path of ['/', '/product/sample-card-set/', '/product/sample-mug/']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        `${path} at ${size.width}px`,
      ).toBeLessThanOrEqual(0);
    }
  }
});

test('with review submission switched off (the default) there is no form on a product page', async ({
  page,
}) => {
  await page.goto('/product/sample-card-set/');
  await expect(page.locator('#reviews')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Write a review' })).toHaveCount(0);
  await expect(page.locator('.review-form')).toHaveCount(0);
  const response = await page.request.post('/api/reviews/', {
    data: {},
    headers: { origin: 'http://localhost:3100' },
  });
  expect(response.status()).toBe(404);
  expect((await response.json()).code).toBe('disabled');
});
