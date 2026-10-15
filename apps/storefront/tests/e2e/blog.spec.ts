import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The blog, Our Story and Contact on the built-in SAMPLE content (src/lib/wp/fixture-client.ts: 11 posts, 2 categories, 2 tags, an
 * Our Story and a Contact page, all marked as sample text). The same pages reading a WordPress stand-in, including hostile markup and
 * outages, are in wordpress-content.spec.ts.
 */

// Videos are third-party pages: a test must not depend on them loading (the sandbox cannot reach them, CI can), and the accessibility
// scan must judge OUR page, not YouTube's. The frames stay in the page, with their own title checked; only their content is not fetched.
test.beforeEach(async ({ page }) => {
  await page.route(/youtube-nocookie\.com|player\.vimeo\.com|youtube\.com/, (route) =>
    route.abort(),
  );
});

test('the blog lists the newest posts, nine to a page, with working page links', async ({
  page,
}) => {
  await page.goto('/blog/');
  await expect(page.getByRole('heading', { level: 1, name: 'Blog' })).toBeVisible();
  const titles = page.locator('article.post-card h3');
  await expect(titles).toHaveCount(9);
  await expect(titles.first()).toHaveText('A sample post with headings and a list');

  const pagination = page.getByRole('navigation', { name: 'Pagination' });
  await expect(pagination).toBeVisible();
  await pagination.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/\/blog\/\?page=2$/);
  await expect(page.locator('article.post-card h3')).toHaveCount(2);
  await expect(page).toHaveTitle(/Blog, page 2/);
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toContain(
    '/blog/?page=2',
  );
  expect((await page.goto('/blog/?page=9'))?.status()).toBe(404);
});

test('a post shows its title, date, categories, tags, reading time, article data and more posts', async ({
  page,
}) => {
  await page.goto('/blog/a-sample-post-with-headings-and-a-list/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A sample post with headings and a list',
  );
  await expect(page.locator('.post__header time')).toHaveAttribute(
    'datetime',
    '2026-10-09T14:00:00.000Z',
  );
  await expect(page.locator('.post__header')).toContainText('October 9, 2026');
  await expect(page.locator('.post__header')).toContainText('min read');
  await expect(page.getByRole('link', { name: 'Behind the Scenes' })).toHaveAttribute(
    'href',
    '/blog/category/behind-the-scenes/',
  );
  await expect(page.getByRole('navigation', { name: 'Tags' })).toContainText('3D Printing');
  // Content headings start at h2 (the title is the only h1).
  await expect(page.locator('.content h2')).toHaveText('A heading inside a post');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'More from the blog' })).toBeVisible();

  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).toMatch(/\/blog\/a-sample-post-with-headings-and-a-list\/$/);
  const ld = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((els) => els.map((el) => JSON.parse(el.textContent ?? '{}')));
  const article = ld.find((d) => d['@type'] === 'BlogPosting');
  expect(article).toMatchObject({
    headline: 'A sample post with headings and a list',
    datePublished: '2026-10-09T14:00:00.000Z',
    author: { '@type': 'Organization' },
  });
  expect(ld.find((d) => d['@type'] === 'BreadcrumbList')).toBeTruthy();
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
});

test('a video in a post loads only from the privacy-enhanced YouTube domain, sandboxed and lazy', async ({
  page,
}) => {
  await page.goto('/blog/a-sample-post-with-a-video/');
  const frame = page.locator('.content iframe');
  await expect(frame).toHaveCount(1);
  expect(await frame.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
  await expect(frame).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(frame).toHaveAttribute('loading', 'lazy');
  await expect(frame).toHaveAttribute('title', 'Sample video');
});

test('category pages list their posts and are indexable; tag pages are not', async ({ page }) => {
  await page.goto('/blog/category/gift-ideas/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gift Ideas');
  await expect(page.getByRole('link', { name: 'Gift Ideas' }).first()).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await page.locator('meta[name="robots"]').count()).toBe(1); // the development build is noindex everywhere
  await page.goto('/blog/tag/3d-printing/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tagged: 3D Printing');
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
  expect((await page.goto('/blog/category/nope/'))?.status()).toBe(404);
  expect((await page.goto('/blog/tag/nope/'))?.status()).toBe(404);
  expect((await page.goto('/blog/not-a-post/'))?.status()).toBe(404);
});

test('Our Story shows the WordPress page, the three newest posts, and a Shop Now button', async ({
  page,
}) => {
  await page.goto('/our-story/');
  await expect(page.getByRole('heading', { level: 1, name: 'Our Story' })).toBeVisible();
  await expect(page.locator('.content')).toContainText('sample text');
  await expect(page.locator('article.post-card')).toHaveCount(3);
  await page.getByRole('link', { name: 'Shop Now' }).click();
  await expect(page).toHaveURL(/\/shop\/$/);
});

test('Contact shows its WordPress page, and /about/ moves permanently to Our Story', async ({
  page,
  request,
}) => {
  await page.goto('/contact/');
  await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible();
  await expect(page.locator('.content')).toContainText('sample text'); // the words still come from WordPress
  const response = await request.get('/about/', { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toContain('/our-story/');
});

test('Contact has an orange Email Us button and the address as a link beneath it, and no form', async ({
  page,
}) => {
  await page.goto('/contact/');
  const button = page.getByRole('link', { name: 'Email Us' });
  await expect(button).toHaveAttribute(
    'href',
    'mailto:contact@kcprintworks.com?subject=KCPrintWorks%20Inquiry',
  );
  await expect(button).toHaveClass(/\bbutton\b/);
  const address = page.getByRole('link', { name: 'contact@kcprintworks.com' });
  await expect(address).toHaveAttribute('href', 'mailto:contact@kcprintworks.com');
  const [buttonBox, addressBox] = [await button.boundingBox(), await address.boundingBox()];
  expect(addressBox!.y).toBeGreaterThan(buttonBox!.y + buttonBox!.height - 1); // beneath the button
  // The button is the brand's orange with dark ink text (not white), like the other buttons.
  const colors = await button.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).toBe('rgb(255, 74, 36)');
  expect(colors.color).toBe('rgb(17, 18, 22)');
  // No form of any kind, and Contact is not in the header (the footer only).
  await expect(page.locator('main form, main input, main textarea')).toHaveCount(0);
  await expect(page.locator('.site-header').getByRole('link', { name: 'Contact' })).toHaveCount(0);
  await expect(
    page.getByRole('contentinfo').getByRole('link', { name: 'Contact' }),
  ).toHaveAttribute('href', '/contact/');
});

test('the home page has no Our Story or Latest-from-the-blog section; both pages stay reachable from the menu and footer', async ({
  page,
}) => {
  await page.goto('/');
  const order = await page
    .locator('main section[data-section]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-section')));
  expect(order).not.toContain('our-story');
  expect(order).not.toContain('latest-posts');
  await expect(page.getByRole('heading', { name: 'Latest from the blog' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Our Story' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Read our story' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Read the blog' })).toHaveCount(0);
  await expect(page.locator('article.post-card')).toHaveCount(0);
  // The pages themselves are untouched: the header's Blog link and the footer's Our Story, Blog and Contact links remain.
  await expect(page.locator('.site-nav a[href="/blog/"]').first()).toBeAttached();
  await expect(page.locator('.site-footer a[href="/our-story/"]')).toBeVisible();
  await expect(page.locator('.site-footer a[href="/blog/"]')).toBeVisible();
});

test('the header Blog link and the footer Our Story, Blog and Contact links go to real pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('.site-nav__inline').getByRole('link', { name: 'Blog' }).click();
  await expect(page).toHaveURL(/\/blog\/$/);
  for (const [name, path] of [
    ['Our Story', '/our-story/'],
    ['Blog', '/blog/'],
    ['Contact', '/contact/'],
  ] as const) {
    const link = page.getByRole('contentinfo').getByRole('link', { name });
    await expect(link).toHaveAttribute('href', path);
  }
});

test('the sitemap lists the blog, its posts, categories, and the managed pages', async ({
  request,
}) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  for (const path of [
    '/blog/',
    '/blog/a-sample-post-with-a-video/',
    '/blog/category/gift-ideas/',
    '/our-story/',
    '/contact/',
  ]) {
    expect(xml.includes(path), path).toBe(true);
  }
  expect(xml.includes('/blog/tag/')).toBe(false); // tag pages stay out of search results
});

test.describe('accessibility', () => {
  for (const path of [
    '/blog/',
    '/blog/a-sample-post-with-headings-and-a-list/',
    '/blog/a-sample-post-with-a-video/',
    '/blog/category/gift-ideas/',
    '/our-story/',
    '/contact/',
  ]) {
    test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    });
  }
});

test('the blog is readable on a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/blog/', '/blog/a-sample-post-with-a-video/', '/our-story/']) {
    await page.goto(path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      path,
    ).toBeLessThanOrEqual(0);
  }
});
