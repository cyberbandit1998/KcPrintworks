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
  await expect(page.locator('.pdp').getByRole('radio')).toHaveCount(26);
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

  const handoffRoute = '**/api/cart/handoff/';
  const shopCalls = async (request: APIRequestContext) =>
    (
      (await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json()).core as {
        route: string;
      }[]
    ).filter((c) => c.route === '/kcpw/v1/cart/handoff').length;

  test('while the shop is being asked, the button says so and a second press sends nothing', async ({
    page,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    let asked = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(handoffRoute, async (route) => {
      asked += 1;
      await gate;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Checkout' }).click();
    const working = page.getByRole('button', { name: 'Preparing checkout…' });
    await expect(working).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#checkout-status')).toContainText('Taking you to secure checkout');
    await working.click({ force: true });
    await working.click({ force: true });
    release();
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
    expect(asked).toBe(1);
  });

  test('the browser sends line intents and nothing else: no price, no total, no address to go to', async ({
    page,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    const sending = page.waitForRequest(handoffRoute);
    await page.getByRole('button', { name: 'Checkout' }).click();
    const sent = (await sending).postDataJSON();
    expect(Object.keys(sent)).toEqual(['lines']);
    expect(sent.lines).toEqual([
      { productId: 103, variationId: 7001, quantity: 1, attributes: { color: 'red' }, options: {} },
    ]);
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
  });

  test('a request that tries to set a price, a total, or where to go is refused and never reaches the shop', async ({
    page,
    request,
  }) => {
    await page.goto('/cart/');
    const before = await shopCalls(request);
    const statuses = await page.evaluate(async () => {
      const line = { productId: 103, variationId: 7001, quantity: 1 };
      const post = (body: unknown) =>
        fetch('/api/cart/handoff/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then((response) => response.status);
      return Promise.all([
        post({ lines: [{ ...line, price: 1 }] }),
        post({ lines: [line], total: 1 }),
        post({ lines: [line], expectedSubtotal: 1 }),
        post({ lines: [line], redirectUrl: 'https://evil.example/' }),
        post({ lines: [line], returnUrl: 'https://evil.example/' }),
        post({ lines: [{ ...line, redirectUrl: 'https://evil.example/' }] }),
      ]);
    });
    expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await shopCalls(request)).toBe(before);
  });

  test('a shop that answers with a link to another site, or another page, is never followed', async ({
    page,
    request,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    for (const mode of ['foreign_redirect', 'wrong_path']) {
      await mockPost(request, 'handoff', { mode });
      await page.getByRole('button', { name: 'Checkout' }).click();
      await expect(page.locator('.notice[role="alert"]')).toContainText(
        'Checkout is not reachable right now',
      );
      await expect(page).toHaveURL(/\/cart\/$/);
    }
  });

  test('an address that is not a web address is never navigated to, even if the server sent it', async ({
    page,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    for (const redirectUrl of ['javascript:alert(1)', 'data:text/html,hi', 'not an address']) {
      await page.route(handoffRoute, (route) =>
        route.fulfill({ contentType: 'application/json', json: { ok: true, redirectUrl } }),
      );
      await page.getByRole('button', { name: 'Checkout' }).click();
      await expect(page.locator('.notice[role="alert"]')).toContainText(
        'Checkout is not reachable right now',
      );
      await expect(page).toHaveURL(/\/cart\/$/);
      await page.unroute(handoffRoute);
    }
  });

  test('an unreachable shop is reported plainly, the cart is kept, and pressing Checkout again works', async ({
    page,
    request,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    await mockPost(request, 'handoff', { mode: 'down' });
    await page.getByRole('button', { name: 'Checkout' }).click();
    const notice = page.locator('.notice[role="alert"]');
    await expect(notice).toContainText('Checkout is not reachable right now');
    await expect(notice).toContainText('Your cart is kept');
    await expect(page).toHaveURL(/\/cart\/$/);
    await expect(page.getByRole('button', { name: 'Checkout' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );

    await mockPost(request, 'handoff', { mode: 'normal' });
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
  });

  test('a dropped connection is reported the same way and does not lock the button', async ({
    page,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    await page.route(handoffRoute, (route) => route.abort());
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      'Checkout is not reachable right now',
    );
    await page.unroute(handoffRoute);
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
  });

  test('a product withdrawn from sale after it was added is named, and no checkout starts', async ({
    page,
    request,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    await mockPost(request, 'product', { id: 103, fields: { status: 'draft' } });
    const before = await shopCalls(request);
    await page.getByRole('button', { name: 'Checkout' }).click();
    const notice = page.locator('.notice[role="alert"]');
    await expect(notice).toContainText('Some items cannot be ordered right now');
    await expect(notice).toContainText('This item is no longer available');
    await expect(page).toHaveURL(/\/cart\/$/);
    await expect(page.getByRole('button', { name: 'Checkout' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    // The shop was asked (it is the authority), said no, and nothing was handed over.
    expect(await shopCalls(request)).toBe(before + 1);
  });

  test('the operator status page sees the shop and its Stripe mode, and shows no secret', async ({
    request,
  }) => {
    const response = await request.get('/api/checkout-status/');
    const text = await response.text();
    const json = JSON.parse(text);
    expect(json).toMatchObject({
      enabled: true,
      environment: 'development',
      allowed: true,
      shop: { reachable: true, plugin: '0.1.0-mock', stripeTestMode: true },
    });
    expect(text).not.toContain(WOO_TEST.handoffSecret);
    expect(text).not.toContain(WOO_TEST.mockUrl);
  });

  test('once the shop is switched to LIVE Stripe mode this non-production build refuses, keeps the cart, and sends nothing', async ({
    page,
    request,
  }) => {
    await addCardBox(page);
    await page.goto('/cart/');
    await mockPost(request, 'shop-status', { stripeTestMode: false });

    // The operator's page says so, plainly, without any secret.
    const status = await (await request.get('/api/checkout-status/')).json();
    expect(status).toMatchObject({
      enabled: true,
      allowed: false,
      blocked: 'live_mode_blocked',
      shop: { reachable: true, stripeTestMode: false },
    });

    const before = await shopCalls(request);
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      'Checkout is not available right now.',
    );
    await expect(page).toHaveURL(/\/cart\/$/);
    await expect(page.getByRole('button', { name: 'Checkout' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(await shopCalls(request), 'no cart reached the shop').toBe(before);

    // Back in test mode the very next press works: nothing about the shop is remembered.
    await mockPost(request, 'shop-status', { stripeTestMode: true });
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.waitForURL(`${WOO_TEST.mockUrl}/?kcpw_handoff=*`);
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
    await expect(page.getByText('Online checkout is not open on this site yet.')).toBeVisible();
  });
});

/**
 * Free-shipping numbers come from the container's environment, per request. This server runs the same build as the default one
 * (minimum $40.00, discounts counted) but is started with FREE_SHIPPING_THRESHOLD=25 and FREE_SHIPPING_BEFORE_DISCOUNTS=true.
 */
test.describe('the free-shipping bar uses the shop’s own numbers', () => {
  test.beforeEach(async ({ page, request }) => {
    await mockPost(request, 'reset', {});
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/cart/');
    await page.evaluate(() => window.localStorage.clear());
  });

  const message = (page: Page) => page.locator('.ship-progress__message');

  async function addCardBoxes(page: Page, quantity: number) {
    await page.goto('/product/synthetic-card-box/');
    await page.getByRole('group', { name: /Color/ }).getByLabel('Red').check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await page.goto('/cart/');
    await page.getByLabel(/^Quantity/).fill(String(quantity));
  }

  test('a $25.00 minimum: $12.50 is half way, $25.00 unlocks', async ({ page }) => {
    await addCardBoxes(page, 1);
    await expect(message(page)).toHaveText("You're only $12.50 away from free shipping!");
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    await page.getByLabel(/^Quantity/).fill('2');
    await expect(message(page)).toHaveText("You've unlocked FREE shipping!");
  });

  test('with the minimum counted before discounts, a discount does not take it back', async ({
    page,
  }) => {
    await page.route('**/api/cart/quote/', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({
        response,
        json: { ...json, discount: { amount: 500, currency: 'USD' } },
      });
    });
    await addCardBoxes(page, 2); // $25.00 of items, $5.00 off
    await expect(message(page)).toHaveText("You've unlocked FREE shipping!");
  });
});

/**
 * Categories, Featured and New Arrivals as WooCommerce defines them (the mock has the owner's verified structure: Game Cases 417 is a
 * parent, Card Games 332 its child, Personalized Gifts 418, and the New Arrivals category 324 that a plugin rotates). Changes made
 * "in WooCommerce" (through the mock's controls) appear after the cache refresh, with no rebuild.
 */
test.describe('categories, Featured and New Arrivals from WooCommerce', () => {
  test.beforeEach(async ({ request }) => {
    await mockPost(request, 'reset', {});
    expect((await revalidate(request)).status()).toBe(202);
  });

  const titles = (page: Page, scope = '.product-grid') =>
    page.locator(`${scope} .card__title`).allTextContents();

  test('Game Cases shows products assigned to it and to its child Card Games, each once', async ({
    page,
  }) => {
    await page.goto('/product-category/game-cases/');
    // Recommended order = WooCommerce's manual order (menu_order), then newest. Beta is in BOTH categories and appears once.
    expect(await titles(page)).toEqual([
      'Synthetic Direct Game Case',
      'Synthetic Card Case Beta',
      'Synthetic Card Case Alpha',
    ]);
    await expect(page.getByText('3 products')).toBeVisible();
    await page.goto('/product-category/card-games/');
    expect(await titles(page)).toEqual(['Synthetic Card Case Beta', 'Synthetic Card Case Alpha']);
  });

  test('the parent works even when every product is in the child (Game Cases itself holds none)', async ({
    page,
    request,
  }) => {
    await mockPost(request, 'product', {
      id: 202,
      fields: { categories: [{ id: 332, name: 'Card Games', slug: 'card-games' }] },
    });
    await mockPost(request, 'product', {
      id: 204,
      fields: { categories: [{ id: 332, name: 'Card Games', slug: 'card-games' }] },
    });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/product-category/game-cases/');
    expect((await titles(page)).sort()).toEqual([
      'Synthetic Card Case Alpha',
      'Synthetic Card Case Beta',
      'Synthetic Direct Game Case',
    ]);
  });

  test('a category assignment made in WooCommerce shows up after the refresh', async ({
    page,
    request,
  }) => {
    await page.goto('/product-category/game-cases/');
    expect(await titles(page)).not.toContain('Synthetic Gift Mug');
    await mockPost(request, 'product', {
      id: 203,
      fields: { categories: [{ id: 417, name: 'Game Cases', slug: 'game-cases' }] },
    });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/product-category/game-cases/');
    expect(await titles(page)).toContain('Synthetic Gift Mug');
    await page.goto('/product-category/personalized-gifts/');
    expect(await titles(page)).not.toContain('Synthetic Gift Mug');
  });

  test('an existing but empty category is a calm page, not an error, and is not offered as a filter', async ({
    page,
  }) => {
    const response = await page.goto('/product-category/empty-category/');
    expect(response?.status()).toBe(200);
    await expect(page.getByText('There are no products in Empty Category yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse all products' })).toHaveAttribute(
      'href',
      '/shop/',
    );
    await page.goto('/shop/');
    await expect(page.getByRole('navigation', { name: 'Categories' })).not.toContainText(
      'Empty Category',
    );
  });

  test('the retired New Arrivals category and the catch-all send you to better pages', async ({
    page,
  }) => {
    await page.goto('/product-category/new-arrivals/');
    await expect(page).toHaveURL(/\/new-arrivals\/$/);
    await page.goto('/product-category/uncategorized/');
    await expect(page).toHaveURL(/\/shop\/$/);
  });

  test('Featured: exactly the starred, published products, in WooCommerce order; unstarring removes them; none = no section', async ({
    page,
    request,
  }) => {
    const featured = () => page.locator('[data-section="featured"] .card__title').allTextContents();
    await page.goto('/');
    // Beta (menu_order 1) before Alpha (menu_order 2). Nothing else is added.
    expect(await featured()).toEqual(['Synthetic Card Case Beta', 'Synthetic Card Case Alpha']);

    // A draft marked Featured is not published, so it never appears.
    await mockPost(request, 'product', { id: 104, fields: { featured: true } });
    // Unstar Beta.
    await mockPost(request, 'product', { id: 202, fields: { featured: false } });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/');
    expect(await featured()).toEqual(['Synthetic Card Case Alpha']);

    // Star a new one: it joins in order.
    await mockPost(request, 'product', { id: 101, fields: { featured: true, menu_order: 0 } });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/');
    expect(await featured()).toEqual([
      'Synthetic Personalized Keychain',
      'Synthetic Card Case Alpha',
    ]);

    // Unstar everything: the whole section is gone, and nothing else takes its place.
    await mockPost(request, 'product', { id: 101, fields: { featured: false } });
    await mockPost(request, 'product', { id: 201, fields: { featured: false } });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/');
    await expect(page.locator('[data-section="featured"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Featured Products' })).toHaveCount(0);
    await expect(page.locator('[data-section="new-arrivals"]')).toBeVisible(); // a separate section, unaffected
  });

  test('New Arrivals: newest PUBLISHED first; the New Arrivals category plays no part', async ({
    page,
    request,
  }) => {
    await page.goto('/new-arrivals/');
    const first = (await titles(page)).slice(0, 5);
    expect(first).toEqual([
      'Synthetic Card Case Beta', // 2026-10-12
      'Synthetic Gift Mug', // 10-11
      'Synthetic Card Case Alpha', // 10-10
      'Synthetic Direct Game Case', // 10-09
      'Synthetic Reviews Off', // 10-08
    ]);
    // "Synthetic Old Arrival" sits in the New Arrivals CATEGORY but was published in January: it comes last.
    const all = await titles(page);
    expect(all.at(-1)).toBe('Synthetic Old Arrival');

    // Publishing something new (a newer publication date) puts it first after the refresh.
    await mockPost(request, 'product', {
      id: 109,
      fields: { date_created_gmt: '2026-10-20T08:00:00' },
    });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/new-arrivals/');
    expect((await titles(page))[0]).toBe('Synthetic Uncategorized Thing');
    // The home page strip agrees.
    await page.goto('/');
    expect((await titles(page, '[data-section="new-arrivals"]'))[0]).toBe(
      'Synthetic Uncategorized Thing',
    );
  });

  test('pagination: 24 per page, working links, a stable address for each page, and a too-high page is clamped', async ({
    page,
    request,
  }) => {
    await mockPost(request, 'bulk', { categoryId: 332, count: 26 });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/product-category/card-games/');
    expect((await titles(page)).length).toBe(24);
    await expect(page.getByText('28 products')).toBeVisible();
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager.getByRole('link', { name: 'Page 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/product-category\/card-games\/$/,
    );

    await pager.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(/\/product-category\/card-games\/\?page=2$/);
    expect((await titles(page)).length).toBe(4);
    await expect(pager.getByRole('link', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\?page=2$/);
    await expect(pager.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      '/product-category/card-games/',
    );

    await page.goto('/product-category/card-games/?page=99');
    await expect(pager.getByRole('link', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The shop paginates too, with the same components; sorting keeps the page links.
    await page.goto('/shop/?sort=price-asc');
    await expect(
      page.getByRole('navigation', { name: 'Pagination' }).getByRole('link', { name: 'Next page' }),
    ).toHaveAttribute('href', '/shop/?sort=price-asc&page=2');
  });

  test('cards show the image, name, price, sale price and availability, for simple and variable products', async ({
    page,
  }) => {
    await page.goto('/product-category/game-accessories/');
    const sale = page.locator('.card', { hasText: 'Card Box' });
    await expect(sale.locator('.card__price')).toContainText('From');
    await expect(sale.locator('.card__price')).toContainText('$12.50');
    // The sale applies to one variation (Red); a card for a variable product shows only "From", the struck price is on the page after the choice.
    await expect(sale.locator('.card__price del')).toHaveCount(0);
    await expect(
      page.locator('.card', { hasText: 'Out Of Stock Stand' }).locator('.badges'),
    ).toContainText('Sold out');
    await expect(sale.locator('img')).toHaveCount(1);
    await expect(sale.getByRole('link', { name: /Card Box/ })).toHaveAttribute(
      'href',
      '/product/synthetic-card-box/',
    );
  });

  test('the header links resolve to the real categories (by their slugs), and a missing one is left out, never guessed', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('.site-nav__inline a')).toHaveText([
      'Shop',
      'Game Cases',
      'Personalized Gifts',
      'New Arrivals',
      'Blog',
    ]);
    const status = await (await request.get('/api/catalog-status/')).json();
    expect(status.nav).toEqual([
      { key: 'game-cases', ref: 'game-cases', categoryId: 417, slug: 'game-cases' },
      {
        key: 'personalized-gifts',
        ref: 'personalized-gifts',
        categoryId: 418,
        slug: 'personalized-gifts',
      },
    ]);
    expect(status.counts.featured).toBe(2);

    // If the category is renamed in WooCommerce, the link is left out (and reported), not pointed at a guess.
    await mockPost(request, 'category', { id: 418, fields: { slug: 'gifts-for-you' } });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/');
    await expect(page.locator('.site-nav__inline a')).toHaveText([
      'Shop',
      'Game Cases',
      'New Arrivals',
      'Blog',
    ]);
    const after = await (await request.get('/api/catalog-status/')).json();
    expect(after.nav[1]).toEqual({
      key: 'personalized-gifts',
      ref: 'personalized-gifts',
      categoryId: null,
      slug: null,
    });
  });
});

/**
 * The blog, Our Story and Contact read from WordPress (here the stand-in in tests/support/wp-fixture.mjs, which also holds hostile markup,
 * protected and draft posts, and can be switched off). Same file as the rest of the mock-store tests so the shared mock is never reset
 * under another test.
 */
test.describe('WordPress content: blog, Our Story, Contact', () => {
  // A video in a post is a third-party page: not fetched in tests (see blog.spec.ts), so the scan judges only our page.
  test.beforeEach(async ({ page }) => {
    await page.route(/youtube-nocookie\.com|player\.vimeo\.com|youtube\.com/, (route) =>
      route.abort(),
    );
  });

  test.beforeEach(async ({ request }) => {
    await mockPost(request, 'reset', {});
    expect((await revalidate(request)).status()).toBe(202);
  });

  const wpLog = async (request: APIRequestContext) =>
    (await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json()).wp as {
      method: string;
      path: string;
      credentialSent: boolean;
    }[];

  test('the blog lists published posts only, with titles decoded and the picture and category shown', async ({
    page,
  }) => {
    await page.goto('/blog/');
    const titles = await page.locator('article.post-card h3').allTextContents();
    expect(titles).toEqual([
      'Hostile content – test & check',
      'The second post',
      'A post without a picture',
    ]);
    expect(titles.join('|')).not.toMatch(/Secret|Draft|&#|&amp;/);
    await expect(page.locator('article.post-card').first()).toContainText('Updates & News');
    await expect(page.locator('article.post-card img')).toHaveCount(1); // only the first post has a featured image
    await expect(page.getByRole('navigation', { name: 'Blog categories' })).toContainText(
      'Updates & News',
    );
    await expect(page.getByRole('navigation', { name: 'Blog categories' })).not.toContainText(
      'Uncategorized',
    );
  });

  test('hostile markup in a post is neutralized in a real browser', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('/blog/hostile-content-test/');
    await page.waitForLoadState('networkidle');
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
    ).toBeUndefined();
    expect(dialogs).toEqual([]);
    const content = page.locator('.content');
    await expect(content).toContainText('Safe paragraph');
    for (const selector of [
      'script',
      'form',
      'input',
      'button',
      'svg',
      '[onerror]',
      '[style]',
      'iframe:not([src^="https://www.youtube-nocookie.com/"])',
    ]) {
      expect(await content.locator(selector).count(), selector).toBe(0);
    }
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
    // The heading that asked for id="main" cannot take the page's own id.
    expect(await page.locator('[id="main"]').count()).toBe(1);
    expect(await page.locator('main h1').count()).toBe(1);
    // Links: to another post and a product -> the storefront; to the checkout -> stays with the shop; external -> rel set.
    await expect(content.locator('a', { hasText: 'Link to another post' })).toHaveAttribute(
      'href',
      '/blog/second-post/',
    );
    await expect(content.locator('a', { hasText: 'a product' })).toHaveAttribute(
      'href',
      '/product/synthetic-mug/',
    );
    expect(await content.locator('a', { hasText: 'the checkout' }).getAttribute('href')).toBe(
      `${WOO_TEST.mockUrl}/checkout/`,
    );
    await expect(content.locator('a', { hasText: 'external link' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    await expect(content.locator('iframe')).toHaveCount(1);
    await expect(content.locator('img')).toHaveAttribute('loading', 'lazy');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });

  test('protected, draft and unknown posts are 404, and the sitemap leaves them out', async ({
    page,
    request,
  }) => {
    for (const slug of ['protected-post', 'draft-post', 'does-not-exist']) {
      expect((await page.goto(`/blog/${slug}/`))?.status(), slug).toBe(404);
    }
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain('/blog/second-post/');
    expect(xml).toContain('/blog/category/updates/');
    expect(xml).toContain('/our-story/');
    expect(xml).not.toMatch(/protected-post|draft-post/);
    expect(xml).not.toContain('/contact/'); // that page does not exist in this WordPress yet
  });

  test('Our Story shows the WordPress page; Contact says so plainly while its page is missing, then shows it', async ({
    page,
    request,
  }) => {
    await page.goto('/our-story/');
    await expect(page.locator('.content')).toContainText('synthetic page stands in');
    await expect(page.locator('article.post-card')).toHaveCount(3);
    await page.goto('/');
    await expect(page.locator('[data-section="our-story"]')).toContainText(
      'The owner wrote this synthetic story',
    );
    await expect(page.locator('[data-section="latest-posts"] article')).toHaveCount(3);

    await page.goto('/contact/');
    // No WordPress page yet: a plain line, and the email button and address are still there.
    await expect(page.getByRole('main')).toContainText('Send us an email');
    await expect(page.getByRole('link', { name: 'Email Us' })).toBeVisible();
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');

    await mockPost(request, 'wp', {
      addPage: {
        slug: 'contact',
        title: 'Contact',
        // What a form plugin leaves in a page: the shortcode as text, and (when the plugin is on) its whole form.
        html:
          '<p>Write to <a href="mailto:hello@example.org">hello@example.org</a>.</p>' +
          '<p>[contact-form-7 id="123" title="Contact form 1"]</p>' +
          '<div class="wpcf7" id="wpcf7-f123-p45-o1"><div class="screen-reader-response"><p role="status" aria-live="polite"></p><ul></ul></div>' +
          '<form action="/contact/#wpcf7-f123-p45-o1" method="post" class="wpcf7-form"><p><label>Your name (required)<br><input type="text" name="your-name"></label></p>' +
          '<p><label>Your message<br><textarea name="your-message"></textarea></label></p><p><input type="submit" value="Send"></p></form></div>',
      },
    });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/contact/');
    await expect(page.locator('.content a[href="mailto:hello@example.org"]')).toBeVisible();
    // The page's own words stay editable in WordPress; the form-plugin leftovers are gone, text and all.
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    for (const leftover of ['contact-form-7', 'Your name (required)', 'Your message', 'Send ']) {
      expect(text.includes(leftover), leftover).toBe(false);
    }
    await expect(page.locator('main form, main input, main textarea')).toHaveCount(0);
    await expect(page.locator('.content p:empty, .content ul:empty')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Email Us' })).toHaveAttribute(
      'href',
      'mailto:contact@kcprintworks.com?subject=KCPrintWorks%20Inquiry',
    );
    await expect(page.getByRole('link', { name: 'contact@kcprintworks.com' })).toBeVisible();
  });

  test('a new post appears after the signed refresh, with paging, and a removed page leaves the home page', async ({
    page,
    request,
  }) => {
    await page.goto('/blog/');
    await expect(page.locator('article.post-card')).toHaveCount(3);
    await mockPost(request, 'wp', { bulkPosts: 12 });
    await page.goto('/blog/');
    await expect(page.locator('article.post-card')).toHaveCount(3); // not yet: the shop remembers the earlier answer
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/blog/');
    await expect(page.locator('article.post-card')).toHaveCount(9);
    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('article.post-card')).toHaveCount(6);

    await mockPost(request, 'wp', { removePage: 'our-story' });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/');
    expect(await page.locator('[data-section="our-story"]').count()).toBe(0);
    await page.goto('/our-story/');
    await expect(page.getByRole('main')).toContainText('Our story is coming soon');
  });

  test('when WordPress is down the last good pages keep working and others say so plainly', async ({
    page,
    request,
  }) => {
    await mockPost(request, 'wp', { bulkPosts: 12 }); // enough posts for a second page in the category
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/blog/'); // remembered
    await page.goto('/blog/second-post/'); // remembered
    await mockPost(request, 'wp', { failing: true });
    expect((await revalidate(request)).status()).toBe(202);

    await page.goto('/blog/');
    await expect(page.locator('article.post-card')).toHaveCount(9); // the remembered first page
    await page.goto('/blog/second-post/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The second post');

    // Never seen before, so nothing to fall back on: a clear message, not a crash, and it asks not to be indexed. (Page 2 of a category:
    // the first page may already be remembered because the browser prefetched the category link from the blog page.)
    const response = await page.goto('/blog/category/updates/?page=2');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('status')).toContainText('unavailable right now');
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveCount(1);
    expect(await robots.getAttribute('content')).toContain('noindex');

    // The rest of the shop is unaffected.
    await page.goto('/shop/');
    await expect(page.locator('article.card').first()).toBeVisible();
    const status = await (await request.get('/api/catalog-status/')).json();
    expect(status.content).toMatchObject({ configured: true });
    expect(status.content.failing).toBeGreaterThan(0);
    expect(JSON.stringify(status)).not.toContain('127.0.0.1');

    await mockPost(request, 'wp', { failing: false });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/blog/category/updates/?page=2');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Updates & News');
  });

  test('WordPress was only ever read, without a credential', async ({ page, request }) => {
    await page.goto('/blog/');
    await page.goto('/blog/hostile-content-test/');
    await page.goto('/our-story/');
    const log = await wpLog(request);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((entry) => entry.method === 'GET')).toBe(true);
    expect(log.some((entry) => entry.credentialSent)).toBe(false);
    expect(log.every((entry) => entry.path.startsWith('/wp-json/wp/v2/'))).toBe(true);
  });
});

/**
 * Reviews from WooCommerce's public Store API (the stand-in in tests/support/wp-fixture.mjs): approved rows only, no email, with an
 * address-like reviewer name, a markup-bearing review, a rating-less reply, and a review of a product the shop does not list.
 */
test.describe('customer reviews from WooCommerce', () => {
  test.beforeEach(async ({ request }) => {
    await mockPost(request, 'reset', {});
    expect((await revalidate(request)).status()).toBe(202);
  });

  const storeLog = async (request: APIRequestContext) =>
    (await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json()).store as {
      method: string;
      path: string;
      credentialSent: boolean;
    }[];

  test('a product page shows its approved reviews with shortened names, and WooCommerce’s own average', async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto('/product/synthetic-card-case-alpha/');
    await expect(page.locator('.rating-summary a')).toContainText('4.5 out of 5 (2 reviews)');
    const cards = page.locator('#reviews .review');
    await expect(cards).toHaveCount(2); // the rating-less reply is not a review
    await expect(cards.first()).toContainText('Alice S.');
    await expect(cards.first()).toContainText('Verified purchase');
    await expect(cards.first().locator('.review__body p')).toHaveText([
      'Great case!',
      'Fits & looks solid.',
    ]);
    await expect(cards.nth(1)).toContainText('Customer'); // the reviewer name was an email address
    await expect(cards.nth(1)).not.toContainText('Verified purchase');
    const html = await page.content();
    for (const leak of ['bob@example.com', 'gravatar', 'Replier', 'window.__pwned']) {
      expect(html.includes(leak), leak).toBe(false);
    }
    expect(dialogs).toEqual([]);
    const ld = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((els) => els.map((el) => JSON.parse(el.textContent ?? '{}')));
    const product = ld.find((d) => d['@type'] === 'Product');
    expect(product.aggregateRating).toMatchObject({ ratingValue: 4.5, reviewCount: 2 });
    expect(product.review.map((r: { author: { name: string } }) => r.author.name)).toEqual([
      'Alice S.',
      'Customer',
    ]);
  });

  test('a product with reviews switched off in WooCommerce shows no review section', async ({
    page,
  }) => {
    await page.goto('/product/synthetic-reviews-off/');
    await expect(page.locator('#reviews')).toHaveCount(0);
    await expect(page.locator('.rating-summary')).toHaveCount(0);
  });

  test('the home page shows reviews of listed products only, linked to them', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('[data-section="reviews"]');
    await expect(section.locator('.review')).toHaveCount(2);
    await expect(section).not.toContainText('Zed');
    await expect(section).not.toContainText('does not list');
    await expect(section.locator('.review a').first()).toHaveAttribute(
      'href',
      '/product/synthetic-card-case-alpha/',
    );
  });

  test('more than ten reviews page through with plain links that return to the reviews', async ({
    page,
    request,
  }) => {
    // (A row without a rating is never shown, so a page can hold fewer than ten; remove that row to keep the counts exact.)
    await mockPost(request, 'reviews', { remove: 503 });
    for (let n = 1; n <= 12; n += 1) {
      await mockPost(request, 'reviews', {
        add: {
          id: 600 + n,
          date_created_gmt: `2026-09-${String(n).padStart(2, '0')}T10:00:00`,
          product_id: 201,
          product_name: 'Synthetic Card Case Alpha',
          reviewer: `Reviewer ${n}`,
          review: `<p>Review number ${n}</p>`,
          rating: 5,
          verified: false,
        },
      });
    }
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/product/synthetic-card-case-alpha/');
    await expect(page.locator('#reviews .review')).toHaveCount(10);
    const next = page.locator('#reviews').getByRole('link', { name: 'Next page' });
    await expect(next).toHaveAttribute(
      'href',
      '/product/synthetic-card-case-alpha/?review_page=2#reviews',
    );
    await next.click();
    await expect(page).toHaveURL(/review_page=2/);
    await expect(page.locator('#reviews .review')).toHaveCount(4);
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(
      /\/product\/synthetic-card-case-alpha\/$/,
    );
  });

  test('a new review shows after the signed refresh, and a removed one disappears', async ({
    page,
    request,
  }) => {
    await page.goto('/product/synthetic-card-case-alpha/');
    await expect(page.locator('#reviews .review')).toHaveCount(2);
    await mockPost(request, 'reviews', { remove: 501 });
    await page.goto('/product/synthetic-card-case-alpha/');
    await expect(page.locator('#reviews .review')).toHaveCount(2); // remembered until the refresh
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/product/synthetic-card-case-alpha/');
    await expect(page.locator('#reviews .review')).toHaveCount(1);
  });

  test('when the reviews cannot be loaded the product page still works and says so', async ({
    page,
    request,
  }) => {
    await mockPost(request, 'reviews', { failing: true });
    expect((await revalidate(request)).status()).toBe(202);
    await page.goto('/product/synthetic-gift-mug/'); // never loaded, so nothing to fall back on
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Synthetic Gift Mug');
    await expect(page.locator('#reviews')).toContainText('Reviews are not available right now');
    await expect(page.getByRole('button', { name: /add to cart/i })).toBeVisible();
    await page.goto('/');
    // The reviews the home page remembered from earlier views are still shown (the last good copy); the rest of the page is unaffected.
    // (A home page with nothing remembered leaves the section out: ReviewsSection draws nothing for an empty list, and the section's
    // 2.5 second limit is covered in the unit tests.)
    await expect(page.locator('[data-section="reviews"] .review')).toHaveCount(2);
    await expect(page.locator('[data-section="new-arrivals"]')).toBeVisible();
  });

  test('reviews were only ever read, without a credential', async ({ page, request }) => {
    await page.goto('/');
    await page.goto('/product/synthetic-card-case-alpha/');
    const log = await storeLog(request);
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((entry) => entry.method === 'GET' && !entry.credentialSent)).toBe(true);
    expect(log.every((entry) => entry.path === '/wp-json/wc/store/v1/products/reviews')).toBe(true);
  });
});

/**
 * Writing a review. This server has review submission switched on and talks to the kcpw-core stand-in, which only LOGS what it gets:
 * it never adds a review to the Store API stand-in, so nothing here can publish a testimonial. The form refuses a submission made
 * within three seconds of the page being drawn, so the tests wait that long before sending.
 */
test.describe('writing a review', () => {
  test.beforeEach(async ({ request }) => {
    await mockPost(request, 'reset', {});
    expect((await revalidate(request)).status()).toBe(202);
  });

  const submitted = async (request: APIRequestContext) =>
    (await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json()).reviews as Record<
      string,
      unknown
    >[];

  const PRODUCT = '/product/synthetic-card-case-alpha/';
  const LONG_ENOUGH = 'I bought this for game night and it is sturdy and neat.';

  async function fill(
    page: Page,
    values: { rating?: number; name?: string; email?: string; review?: string } = {},
  ) {
    const form = page.locator('.review-form');
    const {
      rating = 5,
      name = 'Robin Hood',
      email = 'Robin@Example.com',
      review = LONG_ENOUGH,
    } = values;
    if (rating) await form.getByRole('radio', { name: new RegExp(`^${rating} stars?`) }).check();
    await form.getByLabel(/^Your name/).fill(name);
    await form.getByLabel(/^Your email/).fill(email);
    await form.getByLabel(/^Your review/).fill(review);
    return form;
  }

  // The form needs a few seconds after the page is drawn (a robot filter), so wait before sending.
  const afterTheMinimumWait = (page: Page) => page.waitForTimeout(3300);

  test('the form is there for a product with reviews on, and not for one with reviews off', async ({
    page,
  }) => {
    await page.goto(PRODUCT);
    await expect(page.getByRole('heading', { level: 3, name: 'Write a review' })).toBeVisible();
    await page.goto('/product/synthetic-reviews-off/');
    await expect(page.getByRole('heading', { name: 'Write a review' })).toHaveCount(0);
    await expect(page.locator('.review-form')).toHaveCount(0);
  });

  test('a review is sent to the shop as the shopper typed it, and then waits for approval', async ({
    page,
    request,
  }) => {
    await page.goto(PRODUCT);
    const before = await page.locator('#reviews .review').count();
    const form = await fill(page, { name: '  Robin   Hood ' });
    await afterTheMinimumWait(page);
    await form.getByRole('button', { name: 'Send my review' }).click();

    const done = page.getByRole('status').filter({ hasText: 'received your review' });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expect(done).toContainText('once we’ve approved it');
    await expect(page.locator('.review-form')).toHaveCount(0);

    const log = await submitted(request);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      productId: 201,
      rating: 5,
      name: 'Robin Hood',
      email: 'robin@example.com',
      review: LONG_ENOUGH,
    });
    expect(Object.keys(log[0]!).sort()).toEqual([
      'clientKey',
      'email',
      'name',
      'productId',
      'rating',
      'review',
    ]);
    expect(String(log[0]!.clientKey)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(log[0])).not.toMatch(/127\.0\.0\.1|::1/); // no network address is passed on

    // Not published: it is not on the page now, and not after the page and the shop's cache are refreshed either.
    await expect(page.locator('#reviews .review')).toHaveCount(before);
    expect((await revalidate(request)).status()).toBe(202);
    await page.reload();
    await expect(page.locator('#reviews .review')).toHaveCount(before);
    await expect(page.locator('#reviews')).not.toContainText('game night');
  });

  test('mistakes are caught in the browser: nothing is sent, the problems are listed, and each links to its field', async ({
    page,
    request,
  }) => {
    await page.goto(PRODUCT);
    const form = page.locator('.review-form');
    await form.getByRole('button', { name: 'Send my review' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Please fix these' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('listitem')).toHaveCount(4);
    await summary.getByRole('link', { name: /Choose a rating/ }).click();
    await expect(form.getByRole('radio', { name: /^1 star/ })).toBeFocused();
    await summary.getByRole('link', { name: /Enter your name/ }).click();
    await expect(form.getByLabel(/^Your name/)).toBeFocused();
    await expect(form.getByLabel(/^Your name/)).toHaveAttribute('aria-invalid', 'true');
    expect(await form.getByLabel(/^Your name/).getAttribute('aria-describedby')).toContain(
      '-name-error',
    );

    await fill(page, { review: 'See https://spam.example for the best deals around' });
    await form.getByRole('button', { name: 'Send my review' }).click();
    await expect(page.locator('.review-form [role="alert"]')).toContainText('leave web addresses');
    await fill(page, { email: 'not-an-email' });
    await form.getByRole('button', { name: 'Send my review' }).click();
    await expect(page.locator('.review-form [role="alert"]')).toContainText('valid email address');
    expect(await submitted(request)).toHaveLength(0);
  });

  test('a robot that fills the hidden field is thanked and ignored; a request from another site or without the form token is refused', async ({
    page,
    request,
  }) => {
    await page.goto(PRODUCT);
    await page.evaluate(() => {
      (document.querySelector('input[name="website"]') as HTMLInputElement).value =
        'http://spam.example';
    });
    await fill(page);
    await afterTheMinimumWait(page);
    await page.locator('.review-form').getByRole('button', { name: 'Send my review' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'received your review' }),
    ).toBeVisible();
    expect(await submitted(request)).toHaveLength(0); // looked like success, sent nowhere

    const origin = WOO_TEST.url;
    const fields = {
      productId: 201,
      rating: 5,
      name: 'Robin Hood',
      email: 'robin@example.com',
      review: LONG_ENOUGH,
    };
    const crossSite = await request.post('/api/reviews/', {
      data: { ...fields, formToken: 'x', website: '' },
      headers: { origin: 'https://evil.example' },
    });
    expect(crossSite.status()).toBe(403);
    const noToken = await request.post('/api/reviews/', {
      data: { ...fields, website: '' },
      headers: { origin },
    });
    expect(noToken.status()).toBe(400);
    const verifiedClaim = await request.post('/api/reviews/', {
      data: { ...fields, verified: true, formToken: 'x', website: '' },
      headers: { origin },
    });
    expect(verifiedClaim.status()).toBe(400);
    const forged = await request.post('/api/reviews/', {
      data: { ...fields, formToken: `1800000000.${'a'.repeat(64)}`, website: '' },
      headers: { origin },
    });
    expect(forged.status()).toBe(400);
    expect(await submitted(request)).toHaveLength(0);
  });

  const refusals: [string, string, RegExp][] = [
    [
      'verification',
      'verification_required',
      /Only customers who bought this product can review it/,
    ],
    ['closed', 'closed', /Reviews are closed for this product/],
    ['limited', 'rate_limited', /Too many reviews were sent/],
    ['error', 'unavailable', /could not save your review right now/],
    ['down', 'unavailable', /could not save your review right now/],
  ];
  for (const [mode, , message] of refusals) {
    test(`when the shop answers "${mode}" the shopper is told plainly and keeps what they typed`, async ({
      page,
      request,
    }) => {
      await mockPost(request, 'reviews', { submitMode: mode });
      await page.goto(PRODUCT);
      const form = await fill(page);
      await afterTheMinimumWait(page);
      await form.getByRole('button', { name: 'Send my review' }).click();
      const alert = page.getByRole('alert').filter({ hasText: 'was not sent' });
      await expect(alert).toContainText(message);
      await expect(alert).toBeFocused();
      await expect(form.getByLabel(/^Your review/)).toHaveValue(LONG_ENOUGH);
      await expect(page.locator('.review-form')).toBeVisible();
      expect(JSON.stringify(await alert.innerText())).not.toMatch(/kcpw|rest_|status/i);
    });
  }

  test('the form and its messages have no WCAG 2.2 AA violations, and fit a phone', async ({
    page,
  }) => {
    for (const size of [
      { width: 1280, height: 900 },
      { width: 375, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(PRODUCT);
      const scan = async (label: string) => {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          results.violations.map((v) => `${label} ${size.width}: ${v.id} ${v.nodes[0]?.html}`),
        ).toEqual([]);
      };
      await scan('form');
      await page.locator('.review-form').getByRole('button', { name: 'Send my review' }).click();
      await expect(page.locator('.review-form [role="alert"]')).toBeVisible();
      await scan('errors');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('what pages cost once the shop’s answers are remembered', () => {
  test.beforeEach(async ({ request }) => {
    await mockPost(request, 'reset', {});
    expect((await revalidate(request)).status()).toBe(202);
  });

  const remoteCalls = async (request: APIRequestContext) => {
    const log = await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json();
    return {
      wp: log.wp.length as number,
      store: log.store.length as number,
      woo: log.requests.length as number,
    };
  };

  test('repeat views of the blog, pages, product and home page make no request to WordPress, WooCommerce, or the Store API', async ({
    page,
    request,
  }) => {
    const paths = [
      '/',
      '/blog/',
      '/blog/second-post/',
      '/our-story/',
      '/product/synthetic-card-case-alpha/',
      '/shop/',
    ];
    for (const path of paths) await page.goto(path); // fills the caches
    const before = await remoteCalls(request);
    for (const path of [...paths, ...paths]) await page.goto(path);
    expect(await remoteCalls(request)).toEqual(before);
  });

  test('one first request for a post asks WordPress four times, not once per link or picture', async ({
    request,
  }) => {
    const before = await remoteCalls(request);
    // A plain request, so the browser's prefetching of links on the page cannot add calls of its own.
    expect((await request.get('/blog/hostile-content-test/')).status()).toBe(200);
    const after = await remoteCalls(request);
    // The list of posts, the managed pages' addresses (for rewriting links), the post itself, and the "more posts" list: four,
    // however many links, pictures or videos the post has.
    expect(after.wp - before.wp).toBe(4);
    expect(after.store).toBe(before.store); // and a post needs nothing from the reviews API
  });

  test('the review form adds little JavaScript and never the validation library', async ({
    page,
  }) => {
    const weigh = async (path: string) => {
      let bytes = 0;
      let text = '';
      const pending: Promise<void>[] = [];
      page.on('response', (response) => {
        if ((response.headers()['content-type'] ?? '').includes('javascript')) {
          pending.push(
            response.body().then((body) => {
              bytes += body.length;
              text += body.toString('utf8');
            }),
          );
        }
      });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await Promise.all(pending);
      page.removeAllListeners('response');
      return { bytes, text };
    };
    const without = await weigh('/product/synthetic-reviews-off/'); // reviews off: no form
    const withForm = await weigh('/product/synthetic-card-case-alpha/');
    expect(withForm.bytes - without.bytes).toBeLessThan(25 * 1024);
    expect(withForm.text.includes('ZodError')).toBe(false);
  });
});
