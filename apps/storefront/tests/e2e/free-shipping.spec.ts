import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The free-shipping progress bar in the cart (default server: placeholder catalog, threshold $40.00). Test product: the sticker
 * pack at $8.00, so five of them are exactly $40.00. The bar only DISPLAYS progress toward the shop's minimum; WooCommerce decides
 * the shipping charge. Discounts are simulated by adding `discount` to the quote answer, because coupons are entered at
 * WooCommerce's checkout and the cart's own quote has none (the field exists so the bar is ready when it does).
 */

const AWAY = (amount: string) => `You're only ${amount} away from free shipping!`;
const UNLOCKED = "You've unlocked FREE shipping!";

const message = (page: Page) => page.locator('.ship-progress__message');
const bar = (page: Page) => page.getByRole('progressbar', { name: 'Free shipping progress' });

async function addSticker(page: Page) {
  await page.goto('/product/sample-sticker-pack/');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
}

async function openCart(page: Page, quantity?: number) {
  await addSticker(page);
  await page.goto('/cart/');
  if (quantity !== undefined) await setQuantity(page, quantity);
}

/** The fill grows with a short CSS transition: measure its size only once nothing is animating. */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
}

async function setQuantity(page: Page, quantity: number) {
  await page
    .getByLabel(/^Quantity/)
    .first()
    .fill(String(quantity));
}

/** Answers the cart's price request as usual, plus a discount on the items (in cents). */
async function withDiscount(page: Page, cents: number) {
  await page.route('**/api/cart/quote/', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({
      response,
      json: { ...json, discount: { amount: cents, currency: 'USD' } },
    });
  });
}

test.describe('below, at, and above the $40.00 minimum', () => {
  test('below: says how far away the shopper is and shows a partly filled bar', async ({
    page,
  }) => {
    await openCart(page);
    await expect(message(page)).toHaveText(AWAY('$32.00'));
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '20');
    await expect(bar(page)).toHaveAttribute('aria-valuetext', AWAY('$32.00'));
    await expect(page.getByText(UNLOCKED)).toHaveCount(0);
    await settled(page);
    const fill = await page.locator('.ship-progress__fill').boundingBox();
    const track = await bar(page).boundingBox();
    expect(fill!.width / track!.width).toBeGreaterThan(0.1);
    expect(fill!.width / track!.width).toBeLessThan(0.35);
  });

  test('at exactly $40.00: unlocked, with a full bar', async ({ page }) => {
    await openCart(page, 5);
    await expect(message(page)).toHaveText(UNLOCKED);
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByRole('complementary')).toContainText('$40.00');
    await settled(page);
    const fill = await page.locator('.ship-progress__fill').boundingBox();
    const track = await bar(page).boundingBox();
    expect(fill!.width / track!.width).toBeGreaterThan(0.95);
  });

  test('above $40.00: still unlocked and the bar stays full', async ({ page }) => {
    await openCart(page, 6);
    await expect(message(page)).toHaveText(UNLOCKED);
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByRole('complementary')).toContainText('$48.00');
  });

  test('one cent short is not unlocked, and the bar is not shown as full', async ({ page }) => {
    await withDiscount(page, 1); // $40.00 of items less a 1 cent discount
    await openCart(page, 5);
    await expect(message(page)).toHaveText(AWAY('$0.01'));
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '99');
    await expect(page.getByText(UNLOCKED)).toHaveCount(0);
  });
});

test.describe('the bar follows the cart as it changes, without a reload', () => {
  test('quantity changes move it toward the goal, across it, and back', async ({ page }) => {
    await openCart(page);
    await expect(message(page)).toHaveText(AWAY('$32.00'));
    await setQuantity(page, 2);
    await expect(message(page)).toHaveText(AWAY('$24.00'));
    await setQuantity(page, 4);
    await expect(message(page)).toHaveText(AWAY('$8.00'));
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '80');
    await setQuantity(page, 5);
    await expect(message(page)).toHaveText(UNLOCKED);
    await setQuantity(page, 7);
    await expect(message(page)).toHaveText(UNLOCKED);
    await setQuantity(page, 4); // back down: the promise is withdrawn
    await expect(message(page)).toHaveText(AWAY('$8.00'));
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '80');
    await expect(page.getByText(UNLOCKED)).toHaveCount(0);
  });

  test('updates before the new prices come back (the answer is worked out from the unit prices)', async ({
    page,
  }) => {
    await openCart(page);
    await expect(message(page)).toHaveText(AWAY('$32.00'));
    // Hold the next price request: the line total in the order summary cannot move yet, but the bar already has.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/cart/quote/', async (route) => {
      await gate;
      await route.continue();
    });
    await setQuantity(page, 5);
    await expect(message(page)).toHaveText(UNLOCKED);
    await expect(page.getByRole('complementary')).toContainText('$8.00');
    release();
    await expect(page.getByRole('complementary')).toContainText('$40.00');
    await expect(message(page)).toHaveText(UNLOCKED);
  });

  test('removing an item lowers it, and removing the last one takes the bar away', async ({
    page,
  }) => {
    await addSticker(page);
    await page.goto('/product/sample-card-set/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await page.goto('/cart/');
    await expect(message(page)).toHaveText(AWAY('$18.00')); // $8.00 + $14.00 = $22.00
    await page
      .getByRole('button', { name: /^Remove/ })
      .first()
      .click();
    await expect(message(page)).toHaveText(/away from free shipping/);
    await page.getByRole('button', { name: /^Remove/ }).click();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
  });

  test('adding to the cart from a product page is reflected on the next cart view', async ({
    page,
  }) => {
    await openCart(page, 4);
    await expect(message(page)).toHaveText(AWAY('$8.00'));
    await addSticker(page); // one more
    await page.goto('/cart/');
    await expect(message(page)).toHaveText(UNLOCKED);
  });
});

test.describe('shipping charges are never part of the progress', () => {
  test('four stickers are $32.00 of items; the flat-rate charge (5.25 + 3.25 x 3 = $15.00) is not added', async ({
    page,
  }) => {
    await openCart(page, 4);
    // With shipping counted, $32.00 + $15.00 = $47.00 would wrongly unlock free shipping.
    await expect(message(page)).toHaveText(AWAY('$8.00'));
    await expect(page.getByText(UNLOCKED)).toHaveCount(0);
    await expect(page.getByRole('complementary')).toContainText(
      'Shipping, tax, and any discounts are calculated at checkout.',
    );
    await expect(page.getByRole('complementary')).not.toContainText('$47.00');
  });
});

test.describe('discounts count against the minimum (WooCommerce’s default)', () => {
  test('a discount can take a cart back below the line', async ({ page }) => {
    await withDiscount(page, 1000); // $48.00 of items less $10.00
    await openCart(page, 6);
    await expect(message(page)).toHaveText(AWAY('$2.00'));
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '95');
  });

  test('exactly $40.00 after the discount unlocks; a cent less does not', async ({ page }) => {
    await withDiscount(page, 800);
    await openCart(page, 6);
    await expect(message(page)).toHaveText(UNLOCKED);

    const other = await page.context().newPage();
    await withDiscount(other, 801);
    await other.goto('/cart/');
    await expect(message(other)).toHaveText(AWAY('$0.01'));
  });

  test('a discount bigger than the items cannot push the bar below empty', async ({ page }) => {
    await withDiscount(page, 99_999);
    await openCart(page, 1);
    await expect(message(page)).toHaveText(AWAY('$40.00'));
    await expect(bar(page)).toHaveAttribute('aria-valuenow', '0');
  });

  test('says plainly that the final shipping and any discount code are settled at checkout', async ({
    page,
  }) => {
    await openCart(page);
    await expect(page.locator('.ship-progress__note')).toHaveText(
      'Your final shipping is confirmed at checkout, after any discount code.',
    );
  });
});

test.describe('when it cannot be worked out accurately, nothing is promised', () => {
  test('prices that fail to load show no bar and no promise', async ({ page }) => {
    await page.route('**/api/cart/quote/', (route) => route.abort());
    await openCart(page, 6);
    await expect(page.getByText('We could not update your prices')).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByText(/unlocked/)).toHaveCount(0);
  });

  test('an item with a problem hides the bar until it is fixed', async ({ page }) => {
    await page.route('**/api/cart/quote/', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.lines[0].issues = [{ code: 'out_of_stock', message: 'This item is out of stock.' }];
      json.checkoutReady = false;
      await route.fulfill({ response, json });
    });
    await openCart(page, 6);
    await expect(page.getByText('Fix the items marked above')).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByText(/unlocked/)).toHaveCount(0);
  });

  test('until the first prices arrive, a neutral placeholder holds the space and promises nothing', async ({
    page,
  }) => {
    await addSticker(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/cart/quote/', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/cart/');
    await expect(message(page)).toHaveText('Checking your free shipping progress…');
    await expect(bar(page)).toHaveAttribute('aria-busy', 'true');
    await expect(bar(page)).not.toHaveAttribute('aria-valuenow', /.*/);
    await expect(page.getByText(/unlocked/)).toHaveCount(0);
    release();
    await expect(message(page)).toHaveText(AWAY('$32.00'));
    await expect(bar(page)).not.toHaveAttribute('aria-busy', 'true');
  });
});

test.describe('design and placement', () => {
  test('uses the paper background, orange fill and near-black text', async ({ page }) => {
    await openCart(page, 2);
    const colors = await page.evaluate(() => {
      const css = (selector: string, prop: string) =>
        getComputedStyle(document.querySelector(selector)!).getPropertyValue(prop);
      return {
        card: css('.ship-progress', 'background-color'),
        message: css('.ship-progress__message', 'color'),
        note: css('.ship-progress__note', 'color'),
        fill: css('.ship-progress__fill', 'background-color'),
      };
    });
    expect(colors).toEqual({
      card: 'rgb(243, 235, 221)', // #F3EBDD
      message: 'rgb(17, 18, 22)', // #111216
      note: 'rgb(17, 18, 22)',
      fill: 'rgb(255, 74, 36)', // #FF4A24
    });
  });

  test('desktop: sits at the top of the right-hand column, directly above the order summary', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCart(page, 2);
    const ship = (await page.locator('.ship-progress').boundingBox())!;
    const summary = (await page.locator('aside.summary').boundingBox())!;
    const items = (await page.locator('.cart-items').boundingBox())!;
    expect(ship.y + ship.height).toBeLessThanOrEqual(summary.y);
    expect(summary.y - (ship.y + ship.height)).toBeLessThan(40); // close above it, not a page away
    expect(Math.abs(ship.x - summary.x)).toBeLessThan(2);
    expect(Math.abs(ship.width - summary.width)).toBeLessThan(2);
    expect(items.x + items.width).toBeLessThanOrEqual(ship.x); // the items are the left column
  });

  test('mobile: first in the cart, so it stays in view while quantities change, above the order summary', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openCart(page, 2);
    const ship = (await page.locator('.ship-progress').boundingBox())!;
    const items = (await page.locator('.cart-items').boundingBox())!;
    const summary = (await page.locator('aside.summary').boundingBox())!;
    expect(ship.y).toBeLessThan(items.y);
    expect(items.y).toBeLessThan(summary.y);
    expect(ship.y + ship.height).toBeLessThan(812); // visible without scrolling
  });

  for (const width of [320, 360, 375, 414, 768]) {
    test(`${width}px wide: no horizontal scrolling, nothing clipped, readable text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await openCart(page, 4);
      const metrics = await page.evaluate(() => {
        const el = (selector: string) => document.querySelector<HTMLElement>(selector)!;
        const box = el('.ship-progress').getBoundingClientRect();
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          left: box.left,
          right: box.right,
          viewport: document.documentElement.clientWidth,
          messageClipped:
            el('.ship-progress__message').scrollWidth > el('.ship-progress__message').clientWidth,
          noteClipped:
            el('.ship-progress__note').scrollWidth > el('.ship-progress__note').clientWidth,
          messageSize: parseFloat(getComputedStyle(el('.ship-progress__message')).fontSize),
          noteSize: parseFloat(getComputedStyle(el('.ship-progress__note')).fontSize),
          trackHeight: el('.ship-progress__track').getBoundingClientRect().height,
        };
      });
      expect(metrics.pageOverflow).toBeLessThanOrEqual(0);
      expect(metrics.left).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.messageClipped).toBe(false);
      expect(metrics.noteClipped).toBe(false);
      expect(metrics.messageSize).toBeGreaterThanOrEqual(16);
      expect(metrics.noteSize).toBeGreaterThanOrEqual(14);
      expect(metrics.trackHeight).toBeGreaterThanOrEqual(14);
      await page.screenshot({ path: `test-results/free-shipping-${width}.png`, fullPage: true });
    });
  }

  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCart(page);
    const duration = await page
      .locator('.ship-progress__fill')
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
  });

  test('has no WCAG 2.2 AA violations, below and above the minimum, on desktop and mobile', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      for (const quantity of [2, 6]) {
        await openCart(page, quantity);
        await expect(bar(page)).toBeVisible();
        await page.waitForLoadState('networkidle');
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          `${viewport.width}px, quantity ${quantity}`,
        ).toEqual([]);
      }
    }
  });

  test('the checkout button is unchanged and still disabled on this server', async ({ page }) => {
    await openCart(page, 5);
    await expect(page.getByRole('button', { name: 'Checkout' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByText('Online checkout is not open on this site yet.')).toBeVisible();
  });
});
