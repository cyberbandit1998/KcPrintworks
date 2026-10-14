import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The header and the catalog pages on the PLACEHOLDER catalog (tests/../fixtures.ts), which mirrors the real shop's category shape:
 * Game Cases (417) is a parent, Card Games (332) is its child, Personalized Gifts (418) stands alone. The same behaviors against the
 * mock WooCommerce store (real IDs, dates, Featured stars) are in woo-catalog.spec.ts.
 */

const NAV = [
  ['Shop', '/shop/'],
  ['Game Cases', '/product-category/game-cases/'],
  ['Personalized Gifts', '/product-category/personalized-gifts/'],
  ['New Arrivals', '/new-arrivals/'],
  ['Blog', '/blog/'],
] as const;

const names = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));

test.describe('header: wide screens', () => {
  for (const [width, height] of [
    [960, 800],
    [1024, 800],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    test(`${width}px: Shop | Game Cases | Personalized Gifts | New Arrivals | Blog in one row, then Cart`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const links = page.locator('.site-nav__inline a');
      await expect(links).toHaveCount(5);
      expect(
        await links.evaluateAll((els) =>
          els.map((el) => [el.textContent, el.getAttribute('href')]),
        ),
      ).toEqual(NAV.map(([label, href]) => [label, href]));
      // One row, left to right, in order, and clear of the logo and the cart.
      const boxes = await links.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, height: r.height };
        }),
      );
      const rowY = boxes[0]!.y;
      for (const [index, box] of boxes.entries()) {
        expect(Math.abs(box.y - rowY), `link ${index} stays on the row`).toBeLessThan(2);
        if (index > 0) expect(box.x).toBeGreaterThan(boxes[index - 1]!.right - 1);
      }
      const brand = (await page.locator('.brand').boundingBox())!;
      const cart = (await page.locator('.cart-link').boundingBox())!;
      expect(boxes[0]!.x).toBeGreaterThan(brand.x + brand.width);
      expect(boxes.at(-1)!.right).toBeLessThan(cart.x);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      // The Menu button belongs to narrower screens only, and only one set of links is exposed.
      await expect(page.locator('.site-nav__menu')).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(5);
    });
  }

  test('keeps the logo, the paper background and the cart with its count', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/product/sample-sticker-pack/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await expect(page.locator('.brand__mark')).toHaveText('KC');
    await expect(page.locator('.cart-link')).toContainText('Cart');
    await expect(page.locator('.cart-link__count')).toHaveText('1');
  });

  test('marks the page you are on', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/new-arrivals/');
    await expect(page.locator('.site-nav__inline a[aria-current="page"]')).toHaveText(
      'New Arrivals',
    );
  });
});

test.describe('header: narrower screens use a Menu', () => {
  for (const width of [320, 390, 768, 900]) {
    test(`${width}px: Menu button, five links when opened, cart always visible, no sideways scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await expect(page.locator('.site-nav__inline')).toBeHidden();
      const summary = page.locator('.site-nav__menu summary');
      await expect(summary).toBeVisible();
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator('.site-nav__menu ul')).toBeHidden(); // closed to start with
      await expect(page.locator('.cart-link')).toBeVisible();

      await summary.click();
      const links = page.locator('.site-nav__menu a');
      await expect(links).toHaveCount(5);
      for (const [index, [label, href]] of NAV.entries()) {
        await expect(links.nth(index)).toHaveText(label);
        await expect(links.nth(index)).toHaveAttribute('href', href);
        expect((await links.nth(index).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `test-results/menu-${width}.png`,
        clip: { x: 0, y: 0, width, height: 460 },
      });
    });
  }

  test('Escape closes it and returns focus to the button; following a link closes it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/');
    const summary = page.locator('.site-nav__menu summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.site-nav__menu')).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('.site-nav__menu')).not.toHaveAttribute('open', '');
    await expect(summary).toBeFocused();

    await summary.click();
    await page.locator('.site-nav__menu a', { hasText: 'New Arrivals' }).click();
    await expect(page).toHaveURL(/\/new-arrivals\/$/);
    await expect(page.locator('.site-nav__menu')).not.toHaveAttribute('open', '');
  });

  test('has no WCAG 2.2 AA violations, closed and open, on a phone and a tablet', async ({
    page,
  }) => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const run = () =>
        new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
      expect(
        (await run()).violations.map((v) => v.id),
        `${width} closed`,
      ).toEqual([]);
      await page.locator('.site-nav__menu summary').click();
      expect(
        (await run()).violations.map((v) => v.id),
        `${width} open`,
      ).toEqual([]);
    }
  });
});

test.describe('header: without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the Menu still opens, because it is a native disclosure', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/');
    await page.locator('.site-nav__menu summary').click();
    await expect(page.locator('.site-nav__menu a')).toHaveCount(5);
    await expect(page.locator('.site-nav__menu a').first()).toBeVisible();
  });
});

test.describe('category pages', () => {
  test('Game Cases shows its own products AND its child Card Games’ products, each once', async ({
    page,
  }) => {
    await page.goto('/product-category/game-cases/');
    await expect(page.getByRole('heading', { level: 1, name: 'Game Cases' })).toBeVisible();
    // Sample Sticker Pack is assigned to Game Cases itself; Sample Card Set only to the child Card Games.
    expect(await names(page, '.product-grid .card__title')).toEqual([
      'Sample Card Set',
      'Sample Sticker Pack',
    ]);
    await expect(page.getByRole('navigation', { name: 'Game Cases subcategories' })).toContainText(
      'Card Games',
    );
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Game Cases');
  });

  test('a child category page shows only its own products, with the parent in the breadcrumb', async ({
    page,
  }) => {
    await page.goto('/product-category/card-games/');
    expect(await names(page, '.product-grid .card__title')).toEqual(['Sample Card Set']);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toContainText('Game Cases');
    await expect(crumbs.getByRole('link', { name: 'Game Cases' })).toHaveAttribute(
      'href',
      '/product-category/game-cases/',
    );
  });

  test('WooCommerce’s nested address for a child is accepted and sent to the flat one (no old link breaks)', async ({
    page,
  }) => {
    await page.goto('/product-category/game-cases/card-games/');
    await expect(page).toHaveURL(/\/product-category\/card-games\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Card Games' })).toBeVisible();
  });

  test('unknown categories are a real 404', async ({ page }) => {
    const response = await page.goto('/product-category/not-a-category/');
    expect(response?.status()).toBe(404);
  });

  test('has its own title, description and canonical address; a re-sorted list is kept out of search results', async ({
    page,
  }) => {
    await page.goto('/product-category/personalized-gifts/');
    await expect(page).toHaveTitle('Personalized Gifts | KCPrintWorks');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/product-category\/personalized-gifts\/$/,
    );
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toContain(
      'personalized gifts',
    );
    await page.goto('/product-category/personalized-gifts/?sort=price-asc');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/product-category\/personalized-gifts\/$/,
    );
  });

  test('sorting by price and name orders the cards, and the choice is marked', async ({ page }) => {
    await page.goto('/product-category/personalized-gifts/?sort=price-asc');
    const prices = await names(page, '.product-grid .card__price');
    expect(prices.length).toBe(3);
    const cents = prices.map((p) => Number(/\$(\d+)\.(\d\d)/.exec(p)!.slice(1).join('')));
    expect([...cents].sort((a, b) => a - b)).toEqual(cents);
    await expect(page.locator('.sort-links a[aria-current="true"]')).toHaveText(
      'Price: low to high',
    );
    await page.goto('/product-category/personalized-gifts/?sort=name');
    const sorted = await names(page, '.product-grid .card__title');
    expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b)));
  });
});

test.describe('shop, New Arrivals and the home page sections', () => {
  test('the shop lists every product with category filters (a child only appears under its parent)', async ({
    page,
  }) => {
    await page.goto('/shop/');
    const filters = page.getByRole('navigation', { name: 'Categories' });
    await expect(filters).toContainText('All products');
    await expect(filters).toContainText('Game Cases');
    await expect(filters).toContainText('Personalized Gifts');
    await expect(filters).not.toContainText('Card Games');
    expect((await names(page, '.product-grid .card__title')).length).toBe(9);
  });

  test('New Arrivals are the newest PUBLISHED products first (by date, not by category)', async ({
    page,
  }) => {
    await page.goto('/new-arrivals/');
    const titles = await names(page, '.product-grid .card__title');
    expect(titles.slice(0, 4)).toEqual([
      'Sample Bag Tag (as imported)',
      'Sample Bag Tag',
      'Sample Name Tag',
      'Sample Card Set',
    ]);
    await expect(page).toHaveTitle('New Arrivals | KCPrintWorks');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/new-arrivals\/$/,
    );
  });

  test('home: Featured shows exactly the starred products, then categories, then New Arrivals, after the hero', async ({
    page,
  }) => {
    await page.goto('/');
    const order = await page
      .locator('main > section')
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-section') ?? el.className.split(' ')[0]),
      );
    expect(order.slice(0, 4)).toEqual(['hero', 'featured', 'categories', 'new-arrivals']);
    const featured = page.locator('[data-section="featured"]');
    await expect(
      featured.getByRole('heading', { level: 2, name: 'Featured Products' }),
    ).toBeVisible();
    expect(await names(page, '[data-section="featured"] .card__title')).toEqual([
      'Sample Name Tag',
      'Sample Card Set',
      'Sample Sticker Pack',
    ]);
    const tiles = page.locator('[data-section="categories"] .category-tile__name');
    expect(await tiles.allTextContents()).toEqual([
      'Game Cases',
      'Personalized Gifts',
      'Bags',
      'Extras',
      'Prints', // after the two header categories: WooCommerce order, then name
    ]);
    expect((await names(page, '[data-section="new-arrivals"] .card__title')).length).toBe(8);
    await expect(
      page.locator('[data-section="new-arrivals"] a', { hasText: 'See all new arrivals' }),
    ).toHaveAttribute('href', '/new-arrivals/');
  });

  test('the hero keeps its photo, "Shop Now" and "Our Story"', async ({ page }) => {
    await page.goto('/');
    const hero = page.getByRole('region', { name: /Michigan Made/ });
    await expect(hero.getByRole('link', { name: 'Shop Now' })).toHaveAttribute('href', '/shop/');
    await expect(hero.getByRole('link', { name: 'Our Story' })).toHaveAttribute(
      'href',
      '/our-story/',
    );
    await expect(page.locator('.hero__photo img')).toHaveAttribute('fetchpriority', 'high');
  });

  test('the footer keeps Our Story and Contact reachable', async ({ page }) => {
    await page.goto('/shop/');
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'Our Story' })).toHaveAttribute(
      'href',
      '/our-story/',
    );
    await expect(footer.getByRole('link', { name: 'Contact' })).toHaveAttribute(
      'href',
      '/contact/',
    );
    await expect(footer.getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog/');
  });

  test('product pages show the category path from the tree', async ({ page }) => {
    await page.goto('/product/sample-card-set/');
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toContainText('Game Cases');
    await expect(crumbs).toContainText('Card Games');
  });

  test('the sitemap lists New Arrivals and the browsable categories, not hidden ones', async ({
    request,
  }) => {
    const text = await (await request.get('/sitemap.xml')).text();
    expect(text).toContain('/new-arrivals/');
    expect(text).toContain('/product-category/game-cases/');
    expect(text).toContain('/product-category/card-games/');
    expect(text.includes('/product-category/uncategorized/'), 'uncategorized is not listed').toBe(
      false,
    );
  });
});
