import { expect, test } from '@playwright/test';
import { filled, open, options, type, waitForSuggestions } from '../support/aa';

/**
 * Address autocomplete plugin: the [kcpw_address_autocomplete] shortcode. The page is written by the plugin's real PHP (two shortcodes
 * in one form) and the configuration is what the PHP prints in the footer; Google is a stand-in.
 */

test.use({ baseURL: undefined });

test.describe('two shortcodes in one form', () => {
  test("choosing an address fills that shortcode's hidden fields, which travel with the form", async ({
    page,
  }) => {
    await open(page, 'shortcode');
    await type(page.locator('#kcpw-aa-sc-1-address'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('#kcpw-aa-sc-1-address')).toHaveValue('123 Main Street');
    await expect(page.locator('#kcpw-aa-sc-1-city')).toHaveValue('Flint');
    await expect(page.locator('#kcpw-aa-sc-1-state')).toHaveValue('Michigan');
    await expect(page.locator('#kcpw-aa-sc-1-postcode')).toHaveValue('48502');
    await expect(page.locator('#kcpw-aa-sc-1-country')).toHaveValue('United States');
    await page.locator('#send').click();
    const posted = JSON.parse((await page.locator('#posted').textContent()) ?? '{}');
    expect(posted.home).toBe('123 Main Street');
    expect(posted.home_city).toBe('Flint');
    expect(posted.home_postcode).toBe('48502');
    expect(posted.work, 'the other address is untouched').toBe('');
  });

  test('the second shortcode shows its fields, fills them, and leaves the first alone', async ({
    page,
  }) => {
    await open(page, 'shortcode');
    await type(page.locator('#kcpw-aa-sc-1-address'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await filled(page, 1);
    await type(page.locator('#kcpw-aa-sc-2-address'), '123 King');
    await waitForSuggestions(page, 1);
    await options(page).first().click();
    await filled(page, 2);
    await expect(page.locator('#kcpw-aa-sc-2-city')).toHaveValue('Toronto');
    await expect(page.locator('#kcpw-aa-sc-2-city')).toBeVisible();
    await expect(page.locator('label[for="kcpw-aa-sc-2-city"]')).toHaveText('City');
    await expect(page.locator('#kcpw-aa-sc-2-postcode')).toHaveValue('M5H 1A1');
    await expect(page.locator('#kcpw-aa-sc-1-city'), 'the first address is as it was').toHaveValue(
      'Flint',
    );
    await page.locator('#send').click();
    const posted = JSON.parse((await page.locator('#posted').textContent()) ?? '{}');
    expect(posted).toMatchObject({
      home: '123 Main Street',
      home_city: 'Flint',
      work: '123 King Street West',
      work_city: 'Toronto',
      work_postcode: 'M5H 1A1',
    });
  });

  test('the markup is an ordinary labelled input, and what the PHP made required is required', async ({
    page,
  }) => {
    await open(page, 'shortcode');
    await expect(page.locator('label[for="kcpw-aa-sc-1-address"]')).toHaveText('Home address');
    await expect(page.locator('#kcpw-aa-sc-2-address')).toHaveAttribute('required', '');
    await expect(page.locator('#kcpw-aa-sc-1-address')).not.toHaveAttribute('required', '');
    await expect(page.locator('#kcpw-aa-sc-1-city')).toHaveAttribute('type', 'hidden');
  });

  test('with the plugin not configured at all, the same markup is just a form that works', async ({
    page,
  }) => {
    await open(page, 'shortcode', { config: { forms: [] } });
    await page.locator('#kcpw-aa-sc-1-address').fill('Typed by hand');
    await page.locator('#send').click();
    const posted = JSON.parse((await page.locator('#posted').textContent()) ?? '{}');
    expect(posted.home).toBe('Typed by hand');
  });
});
