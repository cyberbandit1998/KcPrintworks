import { expect, test, type Page } from '@playwright/test';

/**
 * What the new pages cost the browser. The blog, Our Story, Contact and the reviews are server-rendered text: they must add essentially
 * no JavaScript, the validation library must stay out of the browser, the hero photo must keep its priority, and every other picture must
 * be lazy so it never competes with it.
 */
async function weigh(page: Page, path: string) {
  let scriptBytes = 0;
  let scriptText = '';
  const pending: Promise<void>[] = [];
  const onResponse = (response: import('@playwright/test').Response) => {
    if ((response.headers()['content-type'] ?? '').includes('javascript')) {
      pending.push(
        response.body().then((body) => {
          scriptBytes += body.length;
          scriptText += body.toString('utf8');
        }),
      );
    }
  };
  page.on('response', onResponse);
  const main = await page.goto(path);
  await page.waitForLoadState('networkidle');
  await Promise.all(pending);
  page.off('response', onResponse);
  const html = await main!.text();
  return { htmlBytes: Buffer.byteLength(html), scriptBytes, scriptText };
}

test('blog, post, Our Story and Contact add almost no JavaScript beyond an ordinary page', async ({
  page,
}) => {
  const shop = await weigh(page, '/shop/');
  for (const path of [
    '/blog/',
    '/blog/a-sample-post-with-headings-and-a-list/',
    '/blog/category/gift-ideas/',
    '/our-story/',
    '/contact/',
    '/',
  ]) {
    const result = await weigh(page, path);
    expect(result.scriptBytes - shop.scriptBytes, `${path} script bytes over /shop/`).toBeLessThan(
      6 * 1024,
    );
    expect(
      result.scriptText.includes('ZodError'),
      `${path} must not ship the validation library`,
    ).toBe(false);
    expect(result.htmlBytes, `${path} HTML size`).toBeLessThan(160 * 1024);
  }
});

test('the hero photo keeps its priority and every other picture on the home page is lazy', async ({
  page,
}) => {
  await page.goto('/');
  const hero = page.locator('.hero__photo img');
  await expect(hero).toHaveAttribute('fetchpriority', 'high');
  expect(await hero.getAttribute('loading')).not.toBe('lazy');
  const others = await page.locator('img:not(.hero__photo img)').evaluateAll((images) =>
    images.map((img) => ({
      src: img.getAttribute('src') ?? '',
      loading: img.getAttribute('loading'),
      priority: img.getAttribute('fetchpriority'),
    })),
  );
  expect(others.length).toBeGreaterThan(3);
  for (const image of others) {
    expect(image.loading, image.src).toBe('lazy');
    expect(image.priority, image.src).not.toBe('high');
  }
});

test('pictures in a blog post are lazy, except the article’s own lead picture', async ({
  page,
}) => {
  await page.goto('/blog/');
  for (const loading of await page
    .locator('article img')
    .evaluateAll((images) => images.map((i) => i.getAttribute('loading')))) {
    expect(loading).toBe('lazy');
  }
  await page.goto('/blog/a-sample-post-with-headings-and-a-list/');
  const lead = page.locator('.post__image img');
  expect(await lead.getAttribute('loading')).not.toBe('lazy'); // the largest picture on the page: fetched first
  for (const loading of await page
    .locator('.content img, .post-grid img')
    .evaluateAll((images) => images.map((i) => i.getAttribute('loading')))) {
    expect(loading).toBe('lazy');
  }
});

test('pages that read WordPress and WooCommerce are drawn quickly from memory once loaded', async ({
  page,
}) => {
  // The first view fills the caches; later views must not wait on anything remote.
  await page.goto('/blog/');
  await page.goto('/');
  for (const path of ['/', '/blog/', '/our-story/', '/product/sample-card-set/']) {
    const started = Date.now();
    const response = await page.request.get(path);
    expect(response.status()).toBe(200);
    expect(Date.now() - started, `${path} server time`).toBeLessThan(800);
  }
});
