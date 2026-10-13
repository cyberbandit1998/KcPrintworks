import { expect, test, type Page } from '@playwright/test';

/** Everything the browser downloads for one page load: the HTML and the JavaScript it runs. */
async function weigh(page: Page, path: string) {
  let scriptBytes = 0;
  let scriptText = '';
  const pending: Promise<void>[] = [];
  page.on('response', (response) => {
    if ((response.headers()['content-type'] ?? '').includes('javascript')) {
      pending.push(
        response.body().then((body) => {
          scriptBytes += body.length;
          scriptText += body.toString('utf8');
        }),
      );
    }
  });
  const main = await page.goto(path);
  await page.waitForLoadState('networkidle');
  await Promise.all(pending);
  const html = await main!.text();
  return { html, htmlBytes: Buffer.byteLength(html), scriptBytes, scriptText };
}

test.describe('bag tag with two color sets (placeholder data)', () => {
  test('as options: every choice is required, then saved on the cart line', async ({ page }) => {
    await page.goto('/product/sample-bag-tag/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Please fix' });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveCount(4); // tag, text, cable color, name (icon is optional)

    await page.getByLabel(/Tag color/).selectOption('navy');
    await page.getByLabel(/Text color/).selectOption('white');
    await page.getByLabel(/Cable color/).selectOption('silver');
    await page.getByLabel(/Icon/).selectOption('paw');
    await page.getByLabel(/Name or short text/).fill('Robin');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();

    await page.goto('/cart/');
    const details = page.getByRole('list', { name: /Personalization for/ });
    await expect(details).toContainText('Tag color:');
    await expect(details).toContainText('Navy');
    await expect(details).toContainText('Text color:');
    await expect(details).toContainText('White');
    await expect(details).toContainText('Cable color:');
    await expect(details).toContainText('Silver');
    await expect(details).toContainText('Paw');
    await expect(details).toContainText('Robin');
  });

  test('as options: two different color choices stay as two separate cart lines', async ({
    page,
  }) => {
    const add = async (tag: string) => {
      await page.goto('/product/sample-bag-tag/');
      await page.getByLabel(/Tag color/).selectOption(tag);
      await page.getByLabel(/Text color/).selectOption('white');
      await page.getByLabel(/Cable color/).selectOption('black');
      await page.getByLabel(/Name or short text/).fill('Robin');
      await page.getByRole('button', { name: 'Add to cart' }).click();
      await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    };
    await add('red');
    await add('blue');
    await page.goto('/cart/');
    await expect(page.getByRole('list', { name: /Personalization for/ })).toHaveCount(2);
  });

  test('as imported: 169 "Any" variations still select, add, and show the chosen colors', async ({
    page,
  }) => {
    await page.goto('/product/sample-bag-tag-as-imported/');
    await expect(page.getByRole('radio')).toHaveCount(26);
    await page
      .getByRole('group', { name: /Tag Color/ })
      .getByLabel('Navy')
      .check();
    await page
      .getByRole('group', { name: /Text Color/ })
      .getByLabel('Red')
      .check();
    await page.getByLabel(/Name or short text/).fill('Robin');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();

    await page.goto('/cart/');
    await expect(page.getByText('Tag Color: Navy, Text Color: Red')).toBeVisible();
  });

  test('169 variations add almost nothing to what the browser downloads', async ({ page }) => {
    const light = await weigh(page, '/product/sample-name-tag/'); // one variation, two small attributes
    const heavy = await weigh(page, '/product/sample-bag-tag-as-imported/'); // 169 variations, 13 x 13 options

    // Nothing from the variation list that the form does not read may reach the page.
    expect(heavy.html).not.toContain('SAMPLE-BAGTAG-');
    expect(heavy.html).not.toContain('stockQuantity');

    // Regression guard on the total (React, Next, and our client code, ~530 KB decoded today). Adding a
    // dependency to client code, or importing the full contracts entry in it, trips this before shoppers feel it.
    expect(heavy.scriptBytes).toBeLessThan(560 * 1024);
    // The 26 option labels are real markup; the other 168 variations must not be.
    expect(heavy.htmlBytes - light.htmlBytes).toBeLessThan(12 * 1024);
    // The same client code runs for both; the model differs by a few hundred bytes.
    expect(Math.abs(heavy.scriptBytes - light.scriptBytes)).toBeLessThan(2 * 1024);
  });

  test('the validation library (zod) never ships to the browser on the way to a purchase', async ({
    page,
  }) => {
    // It is ~115 KB of JavaScript that only the cart's quote check needs, and that loads after the cart renders.
    for (const path of ['/', '/shop/', '/product/sample-bag-tag-as-imported/', '/cart/']) {
      const { scriptText } = await weigh(page, path);
      expect(scriptText, path).not.toContain('ZodError');
    }
  });

  test('the cart still validates the server quote, loading that code only then', async ({
    page,
  }) => {
    await page.goto('/product/sample-bag-tag/');
    await page.getByLabel(/Tag color/).selectOption('navy');
    await page.getByLabel(/Text color/).selectOption('white');
    await page.getByLabel(/Cable color/).selectOption('silver');
    await page.getByLabel(/Name or short text/).fill('Robin');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();

    const loadedZod: string[] = [];
    const checks: Promise<void>[] = [];
    page.on('response', (response) => {
      if ((response.headers()['content-type'] ?? '').includes('javascript')) {
        checks.push(
          response.text().then((text) => {
            if (text.includes('ZodError')) loadedZod.push(response.url());
          }),
        );
      }
    });
    await page.goto('/cart/');
    await expect(page.getByRole('complementary')).toContainText('$8.99'); // the quote arrived and validated
    await page.waitForLoadState('networkidle');
    await Promise.all(checks); // every script body has been read before counting
    expect(loadedZod.length).toBe(1);
  });
});
