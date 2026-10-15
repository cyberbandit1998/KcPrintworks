import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The WooCommerce checkout dressed like the storefront (wordpress/kcpw-checkout-style).
 *
 * The page under test is a STAND-IN (wordpress/kcpw-checkout-style/tests/fixture): a hand-written approximation of Astra and of the
 * WooCommerce Checkout Block, built from the Checkout Block's open source (class names, container-query layout), carrying competing
 * "default" styles, with the plugin's real header and theme-chrome rule rendered into it by the plugin's own PHP. It proves the
 * stylesheet's rules, scoping, accessibility and layout at phone and desktop widths. It does NOT prove how the real Astra and
 * WooCommerce pages look: the owner's one-time "Preview first" step (docs/CHECKOUT-STYLE.md) does.
 */
const FIXTURE = pathToFileURL(
  path.resolve(process.cwd(), '../../wordpress/kcpw-checkout-style/tests/fixture/checkout.html'),
).href;

const ORANGE = 'rgb(255, 74, 36)';
const INK = 'rgb(17, 18, 22)';

test.use({ baseURL: undefined });

async function open(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(FIXTURE);
}

const style = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

for (const [name, width] of [
  ['desktop 1280', 1280],
  ['tablet 768', 768],
  ['phone 375', 375],
  ['small phone 320', 320],
] as const) {
  test.describe(name, () => {
    test('the theme header and the old promo notice are gone, and a compact KCPrintWorks header is shown', async ({
      page,
    }) => {
      await open(page, width);
      await expect(page.locator('#masthead')).toBeHidden();
      await expect(page.locator('.woocommerce-store-notice')).toBeHidden();
      const header = page.locator('.kcpw-co-header');
      await expect(header).toBeVisible();
      await expect(header.getByText('KCPrintWorks')).toBeVisible();
      const box = (await header.boundingBox())!;
      expect(
        box.height,
        "the header is compact (the storefront's own is 70px)",
      ).toBeLessThanOrEqual(72);
      await expect(page.locator('.kcpw-co-brand__mark')).toHaveCSS('background-color', ORANGE);
      await expect(page.getByRole('link', { name: /Back to cart/ })).toHaveAttribute(
        'href',
        'https://kcprintworks.com/cart/',
      );
      const back = (await page.locator('.kcpw-co-header__back').boundingBox())!;
      expect(back.height, 'a 44px target').toBeGreaterThanOrEqual(44);
    });

    test('the header stays on one line even when the phone’s system font is much wider (GitHub’s runner falls back to DejaVu Sans)', async ({
      page,
    }) => {
      await open(page, width);
      await page.addStyleTag({
        content: '.kcpw-co-header, .kcpw-co-header * { letter-spacing: 0.05em !important; }',
      });
      const box = (await page.locator('.kcpw-co-header').boundingBox())!;
      expect(box.height, 'one line, not two').toBeLessThanOrEqual(72);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const back = (await page.locator('.kcpw-co-header__back').boundingBox())!;
      expect(back.x + back.width, 'the way back stays inside the screen').toBeLessThanOrEqual(
        width,
      );
    });

    test('the place-order button is dark ink on orange with a real boundary, and WooCommerce’s own return link is replaced by the header’s', async ({
      page,
    }) => {
      await open(page, width);
      const button = page.getByRole('button', { name: 'Place Order' });
      await expect(button).toHaveCSS('background-color', ORANGE);
      await expect(button).toHaveCSS('color', INK);
      await expect(button).toHaveCSS('border-top-width', '2px');
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await expect(
        page.locator('.wc-block-components-checkout-return-to-cart-button'),
      ).toBeHidden();
    });

    test('fields, summary and totals take the storefront look, and personalization text stays inside the summary', async ({
      page,
    }) => {
      await open(page, width);
      const input = page.getByLabel('First name');
      await expect(input).toHaveCSS('border-top-width', '2px');
      await expect(input).toHaveCSS('background-color', 'rgb(251, 247, 239)');
      const detail = page.locator('.wc-block-components-product-details__value').first();
      await expect(detail).toBeVisible();
      await expect(detail).toContainText('Robin Alexandria-Montgomery-Fitzgerald-Hollingsworth');
      const summary = (await page
        .locator('.wp-block-woocommerce-checkout-order-summary-block')
        .boundingBox())!;
      const text = (await detail.boundingBox())!;
      expect(
        text.x + text.width,
        'a long personalization wraps inside the summary',
      ).toBeLessThanOrEqual(summary.x + summary.width + 1);
      await expect(
        page.locator(
          '.wc-block-components-totals-footer-item .wc-block-components-totals-item__value',
        ),
      ).toHaveCSS('font-weight', '800');
    });

    test('there is no horizontal scrolling', async ({ page }) => {
      await open(page, width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('no accessibility violations (WCAG 2.2 AA), including the error state', async ({
      page,
    }) => {
      await open(page, width);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    });
  });
}

test('the payment area is drawn exactly as before: the stylesheet changes none of its geometry, stacking or clipping', async ({
  page,
}) => {
  await open(page, 1280);
  // The properties that decide how Stripe's and PayPal's own elements are positioned, stacked, clipped and sized. (The automatic height
  // of the surrounding rows follows the page's text size, which the stylesheet does set, so only the fixed boxes are measured.)
  const GEOMETRY = [
    'position',
    'overflow-x',
    'overflow-y',
    'transform',
    'z-index',
    'display',
    'min-height',
    'max-height',
    'clip-path',
    'filter',
    'pointer-events',
    'visibility',
    'opacity',
  ];
  const read = () =>
    page.evaluate((props) => {
      const out: Record<string, Record<string, string>> = {};
      for (const [key, selector] of Object.entries({
        accordion: '.wc-block-components-radio-control-accordion-option',
        content: '.wc-block-components-radio-control-accordion-content',
        field: '#payment-stand-in',
        frame: '#payment-stand-in iframe',
      })) {
        const el = document.querySelector(selector)!;
        const css = getComputedStyle(el);
        out[key] = Object.fromEntries(props.map((p) => [p, css.getPropertyValue(p)]));
      }
      const frame = document.querySelector('#payment-stand-in iframe')!.getBoundingClientRect();
      const field = document.querySelector('#payment-stand-in')!.getBoundingClientRect();
      out.sizes = { frameHeight: String(frame.height), fieldHeight: String(field.height) };
      return out;
    }, GEOMETRY);
  const withPlugin = await read();
  await page.evaluate(() => {
    (document.querySelector('link[href$="assets/checkout.css"]') as HTMLLinkElement).disabled =
      true;
  });
  const without = await read();
  expect(withPlugin).toEqual(without);
});

test('on any other page (no kcpw-checkout class) nothing changes: the theme header, notice and buttons keep their own look', async ({
  page,
}) => {
  await open(page, 1280);
  await page.evaluate(() => document.body.classList.remove('kcpw-checkout'));
  await expect(page.locator('#masthead')).toBeVisible();
  await expect(page.locator('.woocommerce-store-notice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place Order' })).toHaveCSS(
    'background-color',
    'rgb(30, 30, 30)',
  );
  expect(await style(page, '.entry-title', 'font-size')).toBe('40px');
  await expect(page.locator('.site-footer')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('keyboard: the header links are reachable and show a 3px focus ring', async ({ page }) => {
  await open(page, 1280);
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    if (await page.locator('.kcpw-co-brand').evaluate((el) => el === document.activeElement)) break;
  }
  await expect(page.locator('.kcpw-co-brand')).toBeFocused();
  await expect(page.locator('.kcpw-co-brand')).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('Tab');
  await expect(page.locator('.kcpw-co-header__back')).toBeFocused();
  await expect(page.locator('.kcpw-co-header__back')).toHaveCSS('outline-width', '3px');
});

test('the stylesheet makes no network request of its own (no fonts, images or other sites)', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await open(page, 1280);
  await page.waitForLoadState('load');
  const outside = requested.filter(
    (url) => !url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('about:'),
  );
  expect(outside).toEqual([]);
});
