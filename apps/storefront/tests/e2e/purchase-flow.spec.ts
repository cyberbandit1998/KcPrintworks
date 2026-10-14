import { expect, test } from '@playwright/test';

test.describe('personalized purchase flow (design preview)', () => {
  test('validation errors are summarized, focused, and linked to fields', async ({ page }) => {
    await page.goto('/product/sample-personalized-print/');
    await page.getByRole('button', { name: 'Add to cart' }).click();

    const summary = page.getByRole('alert').filter({ hasText: 'Please fix' });
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveCount(2); // name + frame color

    await summary.getByRole('link', { name: /Name or short text is required/ }).click();
    await expect(page.getByLabel(/Name or short text/)).toBeFocused();
    await expect(page.getByLabel(/Name or short text/)).toHaveAttribute('aria-invalid', 'true');
  });

  test('adds a personalized item, shows server-quoted price, and stores no prices in the browser', async ({
    page,
  }) => {
    await page.goto('/product/sample-personalized-print/');
    await page.getByLabel(/Name or short text/).fill('Ada');
    await page.getByLabel(/Frame color/).selectOption('natural');
    await page.getByLabel(/Gift wrap/).check();
    await expect(page.getByText(/This item:/)).toContainText('$34.00'); // 24 + 6 + 4

    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Cart/ }).first()).toContainText('2');

    const stored = await page.evaluate(() => window.localStorage.getItem('kcpw.cart.v1'));
    expect(stored).toBeTruthy();
    expect(stored!.toLowerCase()).not.toMatch(/price|total|amount/);

    await page.goto('/cart/');
    await expect(page.getByText('Name or short text:')).toBeVisible();
    await expect(page.getByText('Ada')).toBeVisible();
    await expect(page.getByText('Natural wood')).toBeVisible();
    await expect(page.getByText('Gift wrap:')).toBeVisible();
    await expect(page.getByRole('complementary')).toContainText('$68.00');
  });

  test('different personalization creates separate lines; same personalization merges', async ({
    page,
  }) => {
    const add = async (name: string) => {
      await page.goto('/product/sample-personalized-print/');
      await page.getByLabel(/Name or short text/).fill(name);
      await page.getByLabel(/Frame color/).selectOption('black');
      await page.getByRole('button', { name: 'Add to cart' }).click();
      await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    };
    await add('Ada');
    await add('Bea');
    await add('Ada');
    await page.goto('/cart/');
    await expect(page.getByRole('list', { name: /Personalization for/ })).toHaveCount(2);
    await expect(page.getByLabel(/^Quantity/).first()).toHaveValue('2');
  });

  test('variable product requires a choice and flags sold-out combinations', async ({ page }) => {
    await page.goto('/product/sample-custom-poster/');
    await expect(page.locator('.pdp__price')).toContainText('From');

    await page.getByLabel(/Classic/).check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText(
      'Choose a size',
    );

    await page.getByLabel('Large (18 x 24 in)').check();
    await page.getByLabel('Gloss').check();
    await expect(page.getByRole('button', { name: 'Sold out' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Playwright treats aria-disabled as non-actionable; the app keeps the button focusable on purpose.
    await page.getByRole('button', { name: 'Sold out' }).click({ force: true });
    await expect(page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText(
      'sold out',
    );

    await page.getByLabel('Matte').check();
    await expect(page.locator('.pdp__price')).toContainText('$42.00');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
  });

  test('"Any" variation: choices travel with the line, so different colors never merge', async ({
    page,
  }) => {
    const add = async (tagColor: string, name: string) => {
      await page.goto('/product/sample-name-tag/');
      await page.getByLabel(tagColor, { exact: true }).first().check();
      await page.getByLabel('White').check();
      await page.getByLabel(/Name and icon/).fill(name);
      await page.getByRole('button', { name: 'Add to cart' }).click();
      await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    };

    // The only variation is "Any", yet nothing may be bought without choosing both colors.
    await page.goto('/product/sample-name-tag/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Please fix' });
    await expect(summary).toContainText('Choose a tag color');
    await expect(summary).toContainText('Choose a text color');

    await add('Red', 'Robin / Dog');
    await add('Blue', 'Robin / Dog');
    await add('Red', 'Robin / Dog');

    await page.goto('/cart/');
    await expect(page.getByText('Tag Color: Red, Text Color: White')).toHaveCount(1);
    await expect(page.getByText('Tag Color: Blue, Text Color: White')).toHaveCount(1);
    await expect(page.getByLabel(/^Quantity/).first()).toHaveValue('2');
    await expect(page.getByRole('complementary')).toContainText('$26.97'); // 3 x $8.99
  });

  test('sold-out simple product cannot be added', async ({ page }) => {
    await page.goto('/product/sample-mug/');
    const button = page.getByRole('button', { name: 'Sold out' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await button.click({ force: true });
    await expect(page.getByRole('status').getByText(/added to your cart/)).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText(
      'sold out',
    );
  });

  test('cart: change quantity, remove, empty state, and checkout says it is not open yet', async ({
    page,
  }) => {
    await page.goto('/product/sample-sticker-pack/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.goto('/cart/');
    await expect(page.getByRole('complementary')).toContainText('$8.00');

    await page.getByLabel(/^Quantity/).fill('3');
    await expect(page.getByRole('complementary')).toContainText('$24.00');

    const checkout = page.getByRole('button', { name: 'Checkout' });
    await expect(checkout).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(/Online checkout is not open on this site yet/)).toBeVisible();

    await page.getByRole('button', { name: /Remove/ }).click();
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeFocused();
    await expect(page.getByRole('status')).toContainText('removed from your cart');
  });

  test('works when browser storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.goto('/product/sample-sticker-pack/');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('status').getByText(/added to your cart/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Cart/ }).first()).toContainText('1');
  });
});
