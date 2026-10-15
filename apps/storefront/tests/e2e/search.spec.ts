import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Product search on the PLACEHOLDER catalog (src/lib/catalog/fixtures.ts): the header button and panel (live results, keyboard, screen
 * reader text, no-match message), the /search/ page (count, category filters, clear, no results), the homepage "Request a Custom Quote"
 * button, and the same things at phone width and without JavaScript. The catalog refresh case, against the WooCommerce stand-in, is in
 * woo-catalog.spec.ts.
 */

const ORANGE = 'rgb(255, 74, 36)';
const WHITE = 'rgb(255, 255, 255)';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const scan = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target),
  }));

const openPanel = async (page: Page) => {
  await page.locator('.site-search__button').click();
  const input = page.getByRole('combobox', { name: 'Search products' });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  return input;
};

test.describe('header button and panel', () => {
  for (const [label, width, height] of [
    ['desktop', 1280, 800],
    ['tablet', 768, 900],
    ['phone', 375, 800],
    ['small phone', 320, 700],
  ] as const) {
    test(`${label} (${width}px): a search icon sits right next to Cart, both tappable, nothing spills sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const search = (await page.locator('.site-search__button').boundingBox())!;
      const cart = (await page.locator('.cart-link').boundingBox())!;
      expect(search.width).toBeGreaterThanOrEqual(44);
      expect(search.height).toBeGreaterThanOrEqual(44);
      expect(search.x + search.width).toBeLessThanOrEqual(cart.x);
      expect(cart.x - (search.x + search.width)).toBeLessThanOrEqual(16);
      expect(Math.abs(search.y + search.height / 2 - (cart.y + cart.height / 2))).toBeLessThan(2);
      expect(cart.x + cart.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await expect(page.locator('.site-search__button')).toHaveAccessibleName('Search');
    });

    test(`${label}: the panel opens inside the screen with the right placeholder and a focused field`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const input = await openPanel(page);
      await expect(input).toHaveAttribute('placeholder', 'Search games, cases, gifts...');
      const panel = (await page.locator('.site-search__panel').boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      expect(panel.y).toBeGreaterThan(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }

  test('live results show the picture, name, category and price, and a View All Results row', async ({
    page,
  }) => {
    await page.goto('/');
    const input = await openPanel(page);
    await input.pressSequentially('sample', { delay: 20 });
    const rows = page.getByRole('option');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Search suggestions' })).toBeVisible();
    const first = rows.first();
    await expect(first.locator('.site-search__name')).not.toBeEmpty();
    await expect(first.locator('.site-search__meta')).toContainText('$');
    await expect(first.locator('.site-search__meta')).toContainText('·');
    await expect(first.locator('.site-search__thumb img')).toHaveCount(1);
    const last = rows.last();
    await expect(last).toContainText('View All Results');
    await expect(page.locator('.site-search .visually-hidden[role="status"]')).toContainText(
      /\d+ results?\. Use the up and down arrow keys/,
    );
  });

  test('partial words and typos find products', async ({ page }) => {
    await page.goto('/');
    const input = await openPanel(page);
    await input.pressSequentially('tot', { delay: 20 });
    await expect(page.getByRole('option').first()).toContainText('Sample Tote Bag');
    await input.fill('');
    await input.pressSequentially('stickr', { delay: 20 });
    await expect(page.getByRole('option').first()).toContainText('Sample Sticker Pack');
  });

  test('keyboard: arrows move through the rows and wrap, Enter opens the chosen product, Escape closes and returns to the button', async ({
    page,
  }) => {
    await page.goto('/');
    const input = await openPanel(page);
    await input.pressSequentially('sample', { delay: 20 });
    const rows = page.getByRole('option');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(2);

    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveAttribute(
      'aria-activedescendant',
      (await rows.nth(0).getAttribute('id'))!,
    );
    await page.keyboard.press('ArrowUp'); // wraps to the last row, "View All Results"
    await expect(rows.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown'); // and back to the first
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    expect(
      await rows.evaluateAll((els) => els.filter((e) => e.ariaSelected === 'true').length),
    ).toBe(1);
    await expect(input).toBeFocused(); // focus never leaves the field

    const name = await rows.nth(0).locator('.site-search__name').innerText();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/product\/[a-z0-9-]+\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    // The panel starts clean after a navigation.
    await expect(page.locator('.site-search')).not.toHaveAttribute('open', '');

    await page.goto('/');
    const again = await openPanel(page);
    await again.pressSequentially('sample', { delay: 20 });
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.site-search')).not.toHaveAttribute('open', '');
    await expect(page.locator('.site-search__button')).toBeFocused();
  });

  test('Enter with no row chosen, and the last row, go to the full results page', async ({
    page,
  }) => {
    await page.goto('/');
    const input = await openPanel(page);
    await input.pressSequentially('sample', { delay: 20 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/search\/\?q=sample$/);

    await page.goto('/');
    const second = await openPanel(page);
    await second.pressSequentially('sample', { delay: 20 });
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.getByRole('option', { name: /View All Results/ }).click();
    await expect(page).toHaveURL(/\/search\/\?q=sample$/);
  });

  test('a click or tap outside closes the panel', async ({ page }) => {
    await page.goto('/');
    await openPanel(page);
    await page.mouse.click(5, 400);
    await expect(page.locator('.site-search')).not.toHaveAttribute('open', '');
  });

  test('no match: the panel says so and offers a custom quote with the search carried over', async ({
    page,
  }) => {
    await page.goto('/');
    const input = await openPanel(page);
    await input.pressSequentially('ticket to ride', { delay: 15 });
    await expect(page.locator('.site-search__empty')).toContainText(
      'No products match “ticket to ride”.',
    );
    const link = page.locator('.site-search__empty a');
    await expect(link).toHaveText('Can’t find it? Request a Custom Quote');
    await expect(link).toHaveAttribute('href', '/custom-orders/?item=ticket%20to%20ride');
    await expect(page.getByRole('listbox')).toBeHidden();
  });

  test('without JavaScript the button still opens a form that goes to the results page', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('http://localhost:3100/');
    await page.locator('.site-search__button').click();
    await page.locator('.site-search__input').fill('sample');
    await page.locator('.site-search__form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/search\/\?q=sample$/);
    await expect(page.locator('.product-grid > li').first()).toBeVisible();
    await context.close();
  });
});

test.describe('the results page', () => {
  test('shows the count, the matching products, category filters and a clear control', async ({
    page,
  }) => {
    await page.goto('/search/?q=sample');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search results for “sample”');
    const count = page.locator('.page-header [role="status"]');
    await expect(count).toHaveText(/^\d+ results$/);
    const total = Number((await count.innerText()).split(' ')[0]);
    expect(await page.locator('.product-grid > li').count()).toBe(Math.min(total, 24));
    await expect(page.locator('.product-grid > li').first().locator('a')).toHaveAttribute(
      'href',
      /\/product\//,
    );

    const filters = page.getByRole('navigation', { name: 'Filter results by category' });
    await expect(filters.getByRole('link', { name: /^All categories \(\d+\)$/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const chip = filters.getByRole('link', { name: /^Personalized Gifts \(\d+\)$/ });
    await chip.click();
    await expect(page).toHaveURL(/category=personalized-gifts/);
    await expect(page.locator('.page-header [role="status"]')).toContainText(
      'in Personalized Gifts',
    );
    expect(await page.locator('.product-grid > li').count()).toBeLessThan(total);
    await expect(
      page.getByRole('navigation', { name: 'Filter results by category' }).getByRole('link', {
        name: /^Personalized Gifts/,
      }),
    ).toHaveAttribute('aria-current', 'page');

    await page.getByRole('link', { name: /^All categories/ }).click();
    await expect(page).toHaveURL(/\/search\/\?q=sample$/);
    await page.getByRole('link', { name: 'Clear search' }).click();
    await expect(page).toHaveURL(/\/search\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search');
    await expect(page.locator('#search-page-q')).toHaveValue('');
  });

  test('typos and partial words work here too, and the field keeps what was typed', async ({
    page,
  }) => {
    await page.goto('/search/?q=stickr');
    await expect(page.locator('.product-grid')).toContainText('Sample Sticker Pack');
    await expect(page.locator('#search-page-q')).toHaveValue('stickr');
  });

  test('searching from the page form replaces the query and drops the old filter', async ({
    page,
  }) => {
    await page.goto('/search/?q=sample&category=personalized-gifts');
    await page.locator('#search-page-q').fill('mug');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/search\/\?q=mug$/);
    await expect(page.locator('.product-grid')).toContainText('Sample Mug');
  });

  test('no results: a plain message and a custom quote request that carries the search', async ({
    page,
  }) => {
    await page.goto('/search/?q=Ticket%20to%20Ride');
    await expect(
      page.getByRole('heading', { level: 2, name: 'No products match “Ticket to Ride”' }),
    ).toBeVisible();
    await expect(page.getByText('Can’t find it?')).toBeVisible();
    const cta = page.getByRole('link', { name: 'Request a Custom Quote' });
    await expect(cta).toHaveAttribute('href', '/custom-orders/?item=Ticket%20to%20Ride');
    await expect(page.locator('.page-header [role="status"]')).toHaveText('0 results');
    await expect(page.getByRole('link', { name: 'Browse all products' })).toBeVisible();
  });

  test('an empty search invites a query instead of showing every product', async ({ page }) => {
    await page.goto('/search/');
    await expect(page.locator('.product-grid')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'browse the whole shop' })).toBeVisible();
  });

  test('result pages are kept out of search engines, and the home page offers the site search', async ({
    page,
  }) => {
    await page.goto('/search/?q=sample');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.goto('/');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const website = ld.map((t) => JSON.parse(t)).find((d) => d['@type'] === 'WebSite');
    expect(website.potentialAction['@type']).toBe('SearchAction');
    expect(website.potentialAction.target.urlTemplate).toMatch(
      /\/search\/\?q=\{search_term_string\}$/,
    );
  });

  test('hostile text in the address is shown as text and never run', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', async (d) => {
      alerts.push(d.message());
      await d.dismiss();
    });
    await page.goto(`/search/?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
    await expect(page.locator('h1')).toContainText('<img src=x onerror=alert(1)>');
    expect(alerts).toEqual([]);
  });

  for (const [label, width] of [
    ['desktop', 1280],
    ['phone', 375],
  ] as const) {
    test(`${label}: no sideways scrolling, product cards in a grid`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/search/?q=sample');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const xs = await page
        .locator('.product-grid > li')
        .evaluateAll((els) => [
          ...new Set(els.map((e) => Math.round(e.getBoundingClientRect().x))),
        ]);
      expect(xs.length).toBeGreaterThanOrEqual(width > 700 ? 3 : 1);
    });
  }
});

test.describe('accessibility scans (WCAG 2.2 AA)', () => {
  for (const [label, width] of [
    ['desktop', 1280],
    ['phone', 375],
  ] as const) {
    test(`${label}: the panel with results, with no match, and the search page`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const input = await openPanel(page);
      expect(await scan(page)).toEqual([]);
      await input.pressSequentially('sample', { delay: 15 });
      await expect(page.getByRole('option').first()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      expect(await scan(page)).toEqual([]);
      await input.fill('');
      await input.pressSequentially('zzzqqq', { delay: 15 });
      await expect(page.locator('.site-search__empty')).toBeVisible();
      expect(await scan(page)).toEqual([]);

      for (const url of ['/search/', '/search/?q=sample', '/search/?q=zzzqqq']) {
        await page.goto(url);
        expect(await scan(page), url).toEqual([]);
      }
    });
  }
});

test.describe('"Request a Custom Quote" under the hero buttons', () => {
  async function geometry(page: Page) {
    return page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      };
      const links = [...document.querySelectorAll('.hero__actions a')].map((a) => {
        const r = a.getBoundingClientRect();
        return { text: a.textContent?.trim(), x: r.x, y: r.y, bottom: r.bottom, right: r.right };
      });
      return {
        links,
        quote: rect('.hero__quote .button--quote'),
        hero: rect('.hero'),
        text: rect('.hero__text'),
      };
    });
  }

  for (const [label, width, height] of [
    ['desktop', 1440, 900],
    ['laptop', 1280, 800],
    ['tablet', 768, 1000],
    ['phone', 390, 844],
    ['small phone', 320, 700],
  ] as const) {
    test(`${label} (${width}px): Shop Now and Our Story stay side by side, the quote button is a second row, left-aligned with Shop Now`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const g = await geometry(page);
      const shop = g.links.find((l) => l.text === 'Shop Now')!;
      const story = g.links.find((l) => l.text === 'Our Story')!;
      // Unchanged: the two existing buttons share a row.
      expect(Math.abs(shop.y - story.y)).toBeLessThan(2);
      expect(story.x).toBeGreaterThan(shop.right);
      // The new button: below both, and its left edge is Shop Now's left edge.
      expect(g.quote.y).toBeGreaterThanOrEqual(shop.bottom);
      expect(g.quote.y).toBeGreaterThanOrEqual(story.bottom);
      expect(g.quote.y - shop.bottom).toBeLessThanOrEqual(24); // directly below
      expect(Math.abs(g.quote.x - shop.x)).toBeLessThan(1);
      // It stays inside the banner and the screen, and the banner does not push the page sideways.
      expect(g.quote.right).toBeLessThanOrEqual(width);
      expect(g.quote.bottom).toBeLessThanOrEqual(g.hero.y + g.hero.h);
      expect(g.quote.h).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }

  test('orange outline, white text, a message icon first and an arrow after, linking to /custom-orders/', async ({
    page,
  }) => {
    await page.goto('/');
    const button = page.getByRole('link', { name: 'Request a Custom Quote' });
    await expect(button).toHaveAttribute('href', '/custom-orders/');
    const style = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        border: s.borderTopColor,
        width: s.borderTopWidth,
        color: s.color,
        background: s.backgroundColor,
      };
    });
    expect(style.border).toBe(ORANGE);
    expect(style.width).toBe('2px');
    expect(style.color).toBe(WHITE);
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    const icons = button.locator('svg');
    await expect(icons).toHaveCount(2);
    for (const icon of await icons.all()) await expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The icon is before the words and the arrow after them.
    const order = await button.evaluate((el) =>
      [...el.children].map((c) => c.tagName.toLowerCase()),
    );
    expect(order).toEqual(['svg', 'span', 'svg']);
    await expect(button).toHaveAccessibleName('Request a Custom Quote');
  });

  test('hover keeps the white text on an orange tint, and the focus ring is visible', async ({
    page,
  }) => {
    await page.goto('/');
    const button = page.getByRole('link', { name: 'Request a Custom Quote' });
    await button.hover();
    const hovered = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });
    expect(hovered.color).toBe(WHITE);
    expect(hovered.background).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await button.focus();
    const outline = await button.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('the banner keeps its photo, its height range and its heading, and the page passes the accessibility scan', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('.hero__photo img');
      return !!img && img.complete && img.naturalWidth > 0;
    });
    const hero = (await page.locator('.hero').boundingBox())!;
    expect(hero.height).toBeGreaterThanOrEqual(430);
    expect(hero.height).toBeLessThanOrEqual(520);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Michigan Made. Printed to Last.',
    );
    expect(await scan(page)).toEqual([]);
  });

  test('tab order: Shop Now, Our Story, then Request a Custom Quote', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.locator('.hero');
    await hero.getByRole('link', { name: 'Shop Now' }).focus();
    await page.keyboard.press('Tab');
    await expect(hero.getByRole('link', { name: 'Our Story' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(hero.getByRole('link', { name: 'Request a Custom Quote' })).toBeFocused();
  });
});
