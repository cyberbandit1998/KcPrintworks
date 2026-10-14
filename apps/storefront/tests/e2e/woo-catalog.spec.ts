import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
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
  await expect(page.getByRole('note')).toContainText('Stripe test cards');
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
  await expect(page.getByRole('button', { name: 'Checkout' })).toBeVisible(); // switched on for this test server
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

/**
 * The cart handing a shopper to the shop's checkout. This server is in checkout mode and talks to a stand-in for the kcpw-core
 * plugin (tests/support/mock-woo.mjs), which verifies the request signature on its own. The real plugin is proven by its PHP tests
 * and the real shop by the staging checklist. In the same file as the catalog tests because both share one mock store and
 * Playwright would otherwise run them at the same time.
 */
test.describe('checkout handoff', () => {
  async function clearCart(page: Page) {
    await page.goto('/cart/');
    await page.evaluate(() => window.localStorage.clear());
  }

  async function addCardBox(page: Page, color = 'Red') {
    await page.goto('/product/synthetic-card-box/');
    await page.getByRole('group', { name: /Color/ }).getByLabel(color).check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
  }

  test.beforeEach(async ({ page, request }) => {
    await mockPost(request, 'reset', {});
    expect((await revalidate(request)).status()).toBe(202); // the storefront's copy matches the reset store
    await clearCart(page);
  });

  test('a valid cart is handed to the shop and arrives there as the same items, once', async ({
    page,
    request,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    const checkout = page.getByRole('button', { name: 'Checkout' });
    await expect(checkout).toBeVisible();
    await expect(page.getByRole('complementary')).toContainText('$12.50');
    await checkout.click();

    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
    await expect(page.getByRole('heading', { name: 'Mock WooCommerce checkout' })).toBeVisible();
    const cart = JSON.parse((await page.locator('#cart').textContent()) ?? '{}');
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ productId: 103, variationId: 7001, quantity: 1 });
    expect(cart.subtotal).toBe(1250);

    // The link works once.
    const link = page.url();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Link expired' })).toBeVisible();

    // What the storefront server sent: signed, intents only, never a price.
    const log = await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json();
    const sent = log.core.filter((c: { route: string }) => c.route === '/kcpw/v1/cart/handoff');
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['x-kcpw-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(sent[0].body).not.toMatch(/price/i);
    expect(JSON.parse(sent[0].body)).toEqual({
      lines: [
        {
          productId: 103,
          variationId: 7001,
          quantity: 1,
          attributes: { color: 'red' },
          options: {},
        },
      ],
      expectedSubtotal: 1250,
    });
  });

  test('personalization travels with the cart line and reaches the shop exactly as typed', async ({
    page,
  }) => {
    await page.goto('/product/synthetic-plaque/');
    await page.getByLabel(/Inscription/).fill('In loving memory');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await page.goto('/cart/');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
    const cart = JSON.parse((await page.locator('#cart').textContent()) ?? '{}');
    expect(cart.lines[0]).toMatchObject({
      productId: 106,
      quantity: 1,
      options: { inscription: 'In loving memory' },
    });
  });

  test('the shop refusing a personalization it does not know keeps the cart and says why', async ({
    page,
  }) => {
    // The keychain shows proposed fields, but WooCommerce has no stored setup for it: the shop will not take it.
    await page.goto('/product/synthetic-personalized-keychain/');
    await page.getByLabel(/Name or short text/).fill('Robin');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await page.goto('/cart/');
    await page.getByRole('button', { name: 'Checkout' }).click();

    const notice = page.getByRole('alert').filter({ hasText: 'cannot be ordered right now' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Synthetic Personalized Keychain');
    await expect(notice).toContainText('Unknown option');
    await expect(page).toHaveURL(/\/cart\/$/);
    await expect(page.getByText('Robin')).toBeVisible(); // the cart is untouched

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('a price that changed in the store behind the page is reported, never silently charged', async ({
    page,
    request,
  }) => {
    await page.goto('/shop/');
    await page.goto('/product/synthetic-uncategorized/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await page.goto('/cart/');
    await expect(page.getByRole('complementary')).toContainText('$3.00');

    await mockPost(request, 'product', {
      id: 109,
      fields: { price: '3.50', regular_price: '3.50' },
    });
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Something in your cart changed' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/cart\/$/);

    await page.reload(); // the storefront reloaded its catalog when the shop disagreed
    await expect(page.getByRole('complementary')).toContainText('$3.50');
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
  });

  test('the shop sending a shopper back explains why, and ignores unknown words', async ({
    page,
  }) => {
    await addCardBox(page);
    for (const [word, text] of [
      ['changed', 'Something in your cart changed'],
      ['expired', 'expired or was already used'],
      ['unavailable', 'could not be added to checkout'],
    ]) {
      await page.goto(`/cart/?handoff=${word}`);
      await expect(page.getByRole('alert').filter({ hasText: text! })).toBeVisible();
    }
    await page.goto('/cart/?handoff=<script>alert(1)</script>');
    // (Next adds its own route announcer with role=alert, so look for our notice, not for any alert.)
    await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);
  });

  test('checkout is a single press: the button cannot be pressed twice', async ({
    page,
    request,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    const checkout = page.getByRole('button', { name: 'Checkout' });
    await checkout.dblclick();
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
    const log = await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json();
    expect(
      log.core.filter((c: { route: string }) => c.route === '/kcpw/v1/cart/handoff'),
    ).toHaveLength(1);
  });

  test('the operator status page sees the shop and its Stripe mode, and shows no secret', async ({
    request,
  }) => {
    const response = await request.get('/api/checkout-status/');
    const text = await response.text();
    const json = JSON.parse(text);
    expect(json).toMatchObject({
      enabled: true,
      shop: { reachable: true, plugin: '0.1.0-mock', stripeTestMode: true },
    });
    expect(text).not.toContain(WOO_TEST.handoffSecret);
    expect(text).not.toContain(WOO_TEST.mockUrl);
  });

  test('cart page has no WCAG 2.2 AA violations with checkout switched on', async ({ page }) => {
    await addCardBox(page);
    await page.goto('/cart/?handoff=changed');
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });

  test('with checkout off (the default server) the button is disabled and the endpoint refuses', async ({
    page,
    request,
  }) => {
    const off = 'http://localhost:3100';
    const refused = await request.post(`${off}/api/cart/handoff/`, {
      data: { lines: [{ productId: 1, quantity: 1 }] },
    });
    expect(refused.status()).toBe(403);
    expect(await (await request.get(`${off}/api/checkout-status/`)).json()).toMatchObject({
      enabled: false,
    });
    await page.goto(`${off}/product/sample-sticker-pack/`);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.goto(`${off}/cart/`);
    await expect(page.getByRole('button', { name: 'Checkout' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByText('Checkout is not connected')).toBeVisible();
  });
});
