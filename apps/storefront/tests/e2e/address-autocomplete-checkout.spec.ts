import { expect, test, type Page } from '@playwright/test';
import { calls, filled, list, open, options, type, waitForSuggestions } from '../support/aa';

/**
 * Address autocomplete plugin on a WooCommerce Checkout Block STAND-IN built with real React (tests/fixture/block-app.src.js) and on a
 * classic-checkout stand-in. The block stand-in copies the behaviors of the real block that break address plugins: controlled inputs,
 * an address form that rebuilds the whole address from its last rendered value, a state field that is redrawn when the country changes,
 * a hidden second address line, fields that appear late, debounced shipping rates, a billing form that appears on demand, and a
 * payment area nothing else may touch. It is NOT WooCommerce, Stripe or a real shop: those are checked by the install guide's preview.
 */

test.use({ baseURL: undefined });

const store = (page: Page, which: 'shipping' | 'billing' = 'shipping') =>
  page.evaluate((w) => window.__store[w], which);

async function firstSuggestion(page: Page, field: string, text: string, count = 1) {
  await type(page.locator(field), text);
  await waitForSuggestions(page, count);
}

test.describe('Checkout Block stand-in (real React)', () => {
  test('the fields appear after the page has loaded, and the plugin finds them when they do', async ({
    page,
  }) => {
    await open(page, 'block', { query: '?late=900' });
    await expect(page.locator('#shipping-address_1')).toHaveCount(0);
    await expect(page.locator('#shipping-address_1')).toBeVisible({ timeout: 5000 });
    await firstSuggestion(page, '#shipping-address_1', '123 Ma', 2);
    await expect(page.locator('#shipping-address_1')).toHaveAttribute('role', 'combobox');
  });

  test("choosing a suggestion reaches React's own state: every field, none erased by another", async ({
    page,
  }) => {
    await open(page, 'block');
    await page.locator('#shipping-first_name').fill('Robin');
    await page.locator('#shipping-last_name').fill('Alexander');
    await firstSuggestion(page, '#shipping-address_1', '123 Ma', 2);
    await options(page).first().click();
    await filled(page, 1);
    const s = await store(page);
    expect(s).toMatchObject({
      country: 'US',
      state: 'MI',
      city: 'Flint',
      postcode: '48502',
      address_1: '123 Main Street',
      address_2: '',
    });
    expect(s.first_name, 'the name the customer typed is untouched').toBe('Robin');
    expect(s.last_name).toBe('Alexander');
    // and the screen agrees with the state
    await expect(page.locator('#shipping-address_1')).toHaveValue('123 Main Street');
    await expect(page.locator('#shipping-city')).toHaveValue('Flint');
    await expect(page.locator('#shipping-state')).toHaveValue('MI');
    await expect(page.locator('#shipping-postcode')).toHaveValue('48502');
  });

  test('shipping is recalculated for the new address', async ({ page }) => {
    await open(page, 'block');
    await firstSuggestion(page, '#shipping-address_1', '123 Ma', 2);
    await options(page).first().click();
    await expect(page.locator('#shipping-rates')).toHaveAttribute('data-cents', '500');
    await expect(page.locator('#shipping-rates')).toContainText(
      'Shipping to Flint, MI 48502: $5.00',
    );
    // the second suggestion is another city in another state, with another rate
    await page.locator('#shipping-address_1').fill('');
    await firstSuggestion(page, '#shipping-address_1', '123 Ma', 2);
    await options(page).nth(1).click();
    await expect(page.locator('#shipping-rates')).toHaveAttribute('data-cents', '800');
    await expect(page.locator('#shipping-rates')).toContainText('Dallas, TX 75201');
  });

  test('a different country redraws the state field, and the state is still set afterwards', async ({
    page,
  }) => {
    await open(page, 'block');
    await firstSuggestion(page, '#shipping-address_1', '123 King', 1);
    await options(page).first().click();
    await filled(page, 1);
    const s = await store(page);
    expect(s).toMatchObject({
      country: 'CA',
      state: 'ON',
      city: 'Toronto',
      postcode: 'M5H 1A1',
      address_1: '123 King Street West',
    });
    await expect(page.locator('#shipping-state option:checked')).toHaveText('Ontario');
    await expect(page.locator('#shipping-rates')).toHaveAttribute('data-cents', '1500');
  });

  test('a country whose state is a text box (the UK county) is filled too', async ({ page }) => {
    await open(page, 'block');
    await firstSuggestion(page, '#shipping-address_1', '10 Down', 1);
    await options(page).first().click();
    await filled(page, 1);
    await expect.poll(async () => (await store(page)).city).toBe('London');
    const s = await store(page);
    expect(s).toMatchObject({
      country: 'GB',
      city: 'London',
      postcode: 'SW1A 2AA',
      address_1: '10 Downing Street',
      state: 'Greater London',
    });
    expect(await page.locator('#shipping-state').evaluate((el) => el.tagName)).toBe('INPUT');
  });

  test("German street-then-number, and the city's state as text", async ({ page }) => {
    await open(page, 'block');
    await firstSuggestion(page, '#shipping-address_1', 'Haupt', 1);
    await options(page).first().click();
    await filled(page, 1);
    expect(await store(page)).toMatchObject({
      country: 'DE',
      city: 'Berlin',
      postcode: '10115',
      state: 'Berlin',
    });
  });

  test('an apartment opens the hidden second address line and fills it', async ({ page }) => {
    await open(page, 'block');
    await expect(page.locator('#shipping-address_2')).toHaveCount(0);
    await firstSuggestion(page, '#shipping-address_1', '456 Oa', 1);
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('#shipping-address_2')).toBeVisible();
    expect(await store(page)).toMatchObject({
      address_2: 'Unit 4',
      address_1: '456 Oak Avenue',
      city: 'Austin',
      state: 'TX',
      postcode: '78701',
    });
  });

  test('the billing form that appears later gets suggestions too, and shipping is left alone', async ({
    page,
  }) => {
    await open(page, 'block');
    await firstSuggestion(page, '#shipping-address_1', '123 Ma', 2);
    await options(page).first().click();
    await filled(page, 1);
    await page.locator('#use-same-address').uncheck();
    await expect(page.locator('#billing-address_1')).toBeVisible();
    await firstSuggestion(page, '#billing-address_1', '10 Down', 1);
    await options(page).first().click();
    await filled(page, 2);
    expect(await store(page, 'billing')).toMatchObject({
      country: 'GB',
      postcode: 'SW1A 2AA',
      address_1: '10 Downing Street',
    });
    expect(await store(page, 'shipping'), 'shipping is exactly as it was').toMatchObject({
      country: 'US',
      city: 'Flint',
      state: 'MI',
      address_1: '123 Main Street',
    });
  });

  test('the payment area is never touched: no change to its markup, its frame, or any event on it', async ({
    page,
  }) => {
    await open(page, 'block');
    await page.evaluate(() => {
      const w = window;
      w.__paymentMutations = 0;
      w.__paymentEvents = 0;
      w.__frame = document.getElementById('payment-frame');
      for (const id of ['payment-stand-in', 'express-payment-stand-in']) {
        const el = document.getElementById(id)!;
        new MutationObserver((records) => {
          w.__paymentMutations += records.length;
        }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
        for (const type of ['input', 'change', 'focusin', 'click', 'keydown'])
          el.addEventListener(
            type,
            () => {
              w.__paymentEvents += 1;
            },
            true,
          );
      }
    });
    await firstSuggestion(page, '#shipping-address_1', '123 King', 1);
    await options(page).first().click();
    await filled(page, 1);
    await page.locator('#use-same-address').uncheck();
    await firstSuggestion(page, '#billing-address_1', '456 Oa', 1);
    await options(page).first().click();
    await filled(page, 2);
    const result = await page.evaluate(() => {
      const w = window;
      return {
        mutations: w.__paymentMutations,
        events: w.__paymentEvents,
        sameFrame: w.__frame === document.getElementById('payment-frame'),
      };
    });
    expect(result).toEqual({ mutations: 0, events: 0, sameFrame: true });
  });

  test('keyboard only: type, arrow down, Enter fills the form and does not place the order', async ({
    page,
  }) => {
    await open(page, 'block');
    await firstSuggestion(page, '#shipping-address_1', '123 Ma', 2);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await store(page)).city).toBe('Dallas');
    expect(await store(page)).toMatchObject({ state: 'TX', postcode: '75201' });
    expect(
      await page.evaluate(() => window.__placed ?? 0),
      'Enter chose an address; it did not submit the checkout',
    ).toBe(0);
    await expect(page.locator('#shipping-address_1')).toBeFocused();
  });

  test('typing into the address field is never changed by the plugin when no suggestion is chosen', async ({
    page,
  }) => {
    await open(page, 'block');
    await page.locator('#shipping-address_1').fill('PO Box 12, somewhere');
    await page.locator('#shipping-city').fill('Vassar');
    await page.waitForTimeout(800);
    expect(await store(page)).toMatchObject({ address_1: 'PO Box 12, somewhere', city: 'Vassar' });
    await page.locator('#shipping-postcode').click();
    await expect(list(page)).toBeHidden();
  });

  test('older block versions draw country and state as a text combobox: still filled', async ({
    page,
  }) => {
    await open(page, 'block', { query: '?combobox=1' });
    await firstSuggestion(page, '#shipping-address_1', '123 King', 1);
    await options(page).first().click();
    await expect.poll(async () => (await store(page)).state, { timeout: 8000 }).toBe('ON');
    expect(await store(page)).toMatchObject({
      country: 'CA',
      city: 'Toronto',
      postcode: 'M5H 1A1',
      address_1: '123 King Street West',
    });
  });

  test('no script errors, and no more than the expected requests, during a whole checkout fill', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    await open(page, 'block');
    await firstSuggestion(page, '#shipping-address_1', '123 King', 1);
    await options(page).first().click();
    await filled(page, 1);
    expect(problems).toEqual([]);
    const c = await calls(page);
    expect(c.suggest).toHaveLength(1);
    expect(c.details).toHaveLength(1);
  });

  test('CONTROL: a plain `input.value = x` is ignored by this stand-in, as it is by React (so the stand-in is a real controlled form)', async ({
    page,
  }) => {
    await open(page, 'block', { config: (c) => ({ ...c, forms: [] }) });
    await expect(page.locator('#shipping-address_1')).toBeVisible();
    await page.evaluate(() => {
      const el = document.getElementById('shipping-address_1') as HTMLInputElement;
      el.value = '123 Main Street';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    expect((await store(page)).address_1, 'React never saw the value').toBe('');
    // the browser's own setter, which the plugin uses, does reach it
    await page.evaluate(() => {
      const el = document.getElementById('shipping-address_1') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        el,
        '456 Oak Avenue',
      );
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(async () => (await store(page)).address_1).toBe('456 Oak Avenue');
  });
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });

  test('tapping a suggestion fills the block checkout', async ({ page }) => {
    await open(page, 'block', { width: 375, height: 800 });
    await firstSuggestion(page, '#shipping-address_1', '123 King', 1);
    const box = (await page.locator('#kcpw-aa-dd').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await options(page).first().tap();
    await filled(page, 1);
    expect(await store(page)).toMatchObject({ country: 'CA', city: 'Toronto' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('classic checkout stand-in', () => {
  test('fills the fields, tells select2-styled lists, and asks WooCommerce to recalculate once', async ({
    page,
  }) => {
    await open(page, 'classic');
    await firstSuggestion(page, '#billing_address_1', '123 King', 1);
    await options(page).first().click();
    await expect(page.locator('#billing_state')).toHaveValue('ON');
    await expect(page.locator('#billing_country')).toHaveValue('CA');
    await expect(page.locator('#billing_city')).toHaveValue('Toronto');
    await expect(page.locator('#billing_postcode')).toHaveValue('M5H 1A1');
    await expect(page.locator('#billing_address_1')).toHaveValue('123 King Street West');
    const read = () => page.evaluate(() => window.__jq.triggers as { name: string; on: string }[]);
    // WooCommerce is told once, after the fields are final (a moment after the last value, once the plugin has read them back).
    await expect
      .poll(async () => (await read()).filter((t) => t.name === 'update_checkout').length)
      .toBe(1);
    const triggers = await read();
    const selects = triggers.filter((t) => t.name === 'change').map((t) => t.on);
    expect(selects).toContain('#billing_country');
    expect(selects).toContain('#billing_state');
  });
});
