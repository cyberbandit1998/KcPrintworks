import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = [
  '/',
  '/shop/',
  '/product-category/prints/',
  '/product/sample-personalized-print/',
  '/product/sample-custom-poster/',
  '/product/sample-mug/',
  '/cart/',
  '/this-page-does-not-exist/',
];

for (const route of routes) {
  test(`no WCAG 2.2 AA violations: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });
}

test('product page has no violations after validation errors are shown', async ({ page }) => {
  await page.goto('/product/sample-custom-poster/');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('cart page with items has no violations', async ({ page }) => {
  await page.goto('/product/sample-personalized-print/');
  await page.getByLabel(/Name or short text/).fill('Ada');
  await page.getByLabel(/Frame color/).selectOption('natural');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/cart/');
  await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible();
  await expect(page.getByText('Name or short text:')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
