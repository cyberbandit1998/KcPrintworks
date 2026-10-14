import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { WOO_TEST } from '../support/woo-test';

/**
 * The storefront reading a WooCommerce store (here a read-only mock with SYNTHETIC products, tests/support/woo-fixture.mjs).
 * The mock answers GET only and counts anything else, so the last test proves the storefront never writes.
 */
test.use({ baseURL: WOO_TEST.url });
test.describe.configure({ mode: 'serial' });

const mockPost = (request: APIRequestContext, route: string, data: unknown) =>
  request.post(`${WOO_TEST.mockUrl}/__mock/${route}`, { data });

const revalidate = (request: APIRequestContext, signed = true) => {
  const body = JSON.stringify({ source: 'e2e' });
  const signature = createHmac('sha256', WOO_TEST.revalidateSecret).update(body).digest('hex');
  return request.post('/api/revalidate/', {
    data: body,
    headers: {
      'content-type': 'application/json',
      ...(signed ? { 'x-kcpw-signature': `sha256=${signature}` } : {}),
    },
  });
};

test.beforeAll(async ({ request }) => {
  await mockPost(request, 'reset', {});
  expect((await revalidate(request)).status()).toBe(202);
});

test('the shop lists the published WooCommerce products and not drafts or hidden ones', async ({
  page,
}) => {
  await page.goto('/shop/');
  await expect(page.getByRole('note')).toContainText('WooCommerce');
  const names = await page.locator('article.card h2, article.card h3').allInnerTexts();
  expect(names).toContain('Synthetic Bag Tag');
  expect(names).toContain('Synthetic Card Box & Sleeves');
  expect(names.join('|')).not.toContain('Draft');
  expect(names.join('|')).not.toContain('Hidden');
  await expect(page.getByRole('navigation', { name: 'Categories' })).toContainText(
    'Gifts & Keepsakes',
  );
  await expect(page.getByRole('navigation', { name: 'Categories' })).not.toContainText(
    'Empty Category',
  );
});

test('a product keeps its WooCommerce address, variation prices, sale price and sold-out variation', async ({
  page,
}) => {
  await page.goto('/product/synthetic-card-box/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Synthetic Card Box & Sleeves');
  await expect(page.getByRole('main')).toContainText('From $12.50');
  const colors = page.getByRole('group', { name: /Color/ });
  await colors.getByLabel('Red').check();
  await expect(page.getByRole('main')).toContainText('$12.50');
  await expect(page.getByRole('main')).toContainText('$15.00'); // the struck-through regular price
  await colors.getByLabel('Dark Green').check();
  await expect(page.getByRole('main')).toContainText('$14.00');
  await colors.getByLabel('Blue').check();
  await expect(page.getByRole('button', { name: /sold out/i })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('the bag tag keeps 169 "Any" variations as two color pickers and adds to the cart priced from WooCommerce', async ({
  page,
}) => {
  await page.goto('/product/synthetic-bag-tag/');
  await expect(page.getByRole('radio')).toHaveCount(26);
  await page
    .getByRole('group', { name: /Tag Color/ })
    .getByLabel('Navy')
    .check();
  await page
    .getByRole('group', { name: /Text Color/ })
    .getByLabel('Red')
    .check();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
  await page.goto('/cart/');
  await expect(page.getByText('Tag Color: Navy, Text Color: Red')).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText('$12.00'); // the quote came from the WooCommerce catalog
  await expect(page.locator('#checkout-note')).toContainText('Checkout is not connected');
});

test('a product with a stored option schema shows it; a personalized title gets proposed fields', async ({
  page,
}) => {
  await page.goto('/product/synthetic-plaque/');
  await expect(page.getByLabel(/Inscription/)).toBeVisible();
  await page.goto('/product/synthetic-personalized-keychain/');
  await expect(page.getByLabel(/Name or short text/)).toBeVisible();
});

test('product photos come from WooCommerce, and a photo from an unknown host does not break its page', async ({
  page,
}) => {
  await page.goto('/product/synthetic-stand/');
  const photo = page.locator('main img').first();
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  const elsewhere = await page.goto('/product/synthetic-elsewhere/');
  expect(elsewhere?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Synthetic Photo From Elsewhere',
  );
});

test('unknown, draft and hidden products are 404', async ({ page }) => {
  for (const slug of ['nope', 'synthetic-draft', 'synthetic-hidden']) {
    const response = await page.goto(`/product/${slug}/`);
    expect(response?.status(), slug).toBe(404);
  }
});

test('the sitemap lists the live products with their WooCommerce addresses', async ({
  request,
}) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  expect(xml).toContain('/product/synthetic-bag-tag/');
  expect(xml).not.toContain('synthetic-draft');
});

test('no credential or signing secret reaches the browser', async ({ page }) => {
  const bodies: string[] = [];
  page.on('response', async (response) => {
    const type = response.headers()['content-type'] ?? '';
    if (/javascript|html|json/.test(type) && response.url().startsWith(WOO_TEST.url))
      bodies.push(await response.text().catch(() => ''));
  });
  for (const route of ['/', '/shop/', '/product/synthetic-bag-tag/', '/cart/']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
  }
  const everything = bodies.join('\n');
  expect(everything.length).toBeGreaterThan(100_000);
  // Booleans, not the text itself: a failure must not print megabytes of page source. (The store's address is public:
  // product photos are served from it, so it is allowed to appear.)
  for (const [name, secret] of [
    ['consumer key', 'ck_mock_read_only_key'],
    ['consumer secret', 'cs_mock_read_only_secret'],
    ['revalidation secret', WOO_TEST.revalidateSecret],
  ] as const) {
    expect(everything.includes(secret), `${name} must not reach the browser`).toBe(false);
  }
});

test.describe('a change in WooCommerce reaches the page without a rebuild or restart', () => {
  test('the signed refresh request is required', async ({ request }) => {
    expect((await revalidate(request, false)).status()).toBe(401);
  });

  test('edit -> still cached -> signed refresh -> new price and name on the page', async ({
    page,
    request,
  }) => {
    await page.goto('/product/synthetic-personalized-keychain/');
    await expect(page.getByRole('main')).toContainText('$8.99');

    await mockPost(request, 'product', {
      id: 101,
      fields: { price: '10.49', regular_price: '10.49', name: 'Synthetic Keychain, Renamed' },
    });
    await page.goto('/product/synthetic-personalized-keychain/');
    await expect(page.getByRole('main')).toContainText('$8.99'); // served from memory until WooCommerce says otherwise

    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/product/synthetic-personalized-keychain/');
    await expect(page.getByRole('main')).toContainText('$10.49');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Synthetic Keychain, Renamed');
  });

  test('the freshness script finds the change, and refreshes, against the running server', async ({
    request,
  }) => {
    const script = path.resolve(process.cwd(), '../../scripts/verify-catalog-freshness.mjs');
    const env = { ...process.env, REVALIDATE_SECRET: WOO_TEST.revalidateSecret };
    const run = (...args: string[]) =>
      execFileSync('node', [script, ...args, '--base', WOO_TEST.url], { env, encoding: 'utf8' });
    await mockPost(request, 'product', {
      id: 101,
      fields: { price: '11.00', regular_price: '11.00' },
    });
    expect(run('refresh')).toContain('PASS');
    expect(
      run(
        'wait',
        '--path',
        '/product/synthetic-personalized-keychain/',
        '--expect',
        '$11.00',
        '--interval',
        '1',
        '--timeout',
        '30',
      ),
    ).toContain('PASS');
    const status = run('status', '--product', '101');
    expect(status).toContain('Catalog source: WooCommerce');
    expect(status).toContain('$11.00');
  });

  test('when WooCommerce goes down the shop keeps showing the last good catalog', async ({
    page,
    request,
  }) => {
    await mockPost(request, 'fail', { failing: true });
    expect((await revalidate(request)).status()).toBe(202);
    const response = await page.goto('/product/synthetic-bag-tag/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Synthetic Bag Tag');
    const status = await (await request.get('/api/catalog-status/')).json();
    expect(status.status.lastError).toContain('HTTP 503');
    await mockPost(request, 'fail', { failing: false });
    expect((await revalidate(request)).status()).toBe(202);
  });
});

test('shop and product pages have no WCAG 2.2 AA violations', async ({ page }) => {
  for (const route of ['/shop/', '/product/synthetic-card-box/', '/product/synthetic-bag-tag/']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({ route, id: v.id })),
      route,
    ).toEqual([]);
  }
});

test('the storefront only ever read from WooCommerce', async ({ request }) => {
  const log = await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json();
  expect(log.requests.length).toBeGreaterThan(0);
  expect(log.writes).toBe(0);
  expect(log.unauthorized).toBe(0);
  expect(log.requests.every((r: { method: string }) => r.method === 'GET')).toBe(true);
});
