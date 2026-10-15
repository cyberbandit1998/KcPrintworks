import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openAdmin } from '../support/aa';

/**
 * Address autocomplete plugin: the administrator screens. Each page is written by the plugin's real PHP and wrapped in a rough stand-in
 * for the WordPress admin page (not WordPress's own stylesheet), so these tests prove the plugin's markup, behavior and accessibility,
 * not how WordPress draws its own controls around them. "Test my key" runs against the Google stand-in.
 */

test.use({ baseURL: undefined });

const SCREENS = [
  ['dashboard', 'admin-dashboard.html'],
  ['settings: general', 'admin-settings-general.html'],
  ['settings: behavior', 'admin-settings-behavior.html'],
  ['settings: appearance', 'admin-settings-style.html'],
  ['forms list', 'admin-forms.html'],
  ['form editor', 'admin-editor.html'],
  ['wizard step 1', 'admin-wizard-1.html'],
  ['wizard step 2', 'admin-wizard-2.html'],
  ['wizard step 3', 'admin-wizard-3.html'],
] as const;

for (const [label, file] of SCREENS) {
  for (const width of [1280, 375]) {
    test(`${label} at ${width}px: no WCAG 2.2 AA violations and no sideways scrolling`, async ({
      page,
    }) => {
      await openAdmin(page, file, { width });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'sideways scrolling').toBeLessThanOrEqual(0);
    });
  }
}

test.describe('"Test my key"', () => {
  const rows = (page: import('@playwright/test').Page) => page.locator('#kcpw-aa-test-results li');

  test('with everything working, each service is reported as working', async ({ page }) => {
    await openAdmin(page, 'admin-dashboard.html');
    await page.getByRole('button', { name: 'Test my key' }).click();
    await expect(rows(page)).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(rows(page).nth(i)).toHaveClass(/is-ok/);
    await expect(rows(page).nth(0)).toContainText('Working');
    await expect(rows(page).nth(1)).toContainText('Places API (New)');
    await expect(rows(page).nth(2)).toContainText('Geocoding API');
    await expect(page.getByRole('button', { name: 'Test my key' })).toBeEnabled();
  });

  test('the test asks for suggestions and an address lookup once each, and only that', async ({
    page,
  }) => {
    await openAdmin(page, 'admin-dashboard.html');
    await page.getByRole('button', { name: 'Test my key' }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2)).toHaveClass(/is-ok/);
    const c = await page.evaluate(() => window.__KCPW_G.calls);
    expect(c?.suggest).toHaveLength(1);
    expect(c?.details).toHaveLength(0);
  });

  test('a blocked Google script is explained, and the later steps are not attempted', async ({
    page,
  }) => {
    await openAdmin(page, 'admin-dashboard.html', { blockGoogle: true });
    await page.getByRole('button', { name: 'Test my key' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveClass(/is-fail/);
    await expect(rows(page).first()).toContainText('maps.googleapis.com');
    await expect(page.getByRole('button', { name: 'Test my key' })).toBeEnabled();
  });

  test('a rejected key is explained', async ({ page }) => {
    await openAdmin(page, 'admin-dashboard.html', { scenario: { authFailure: true, delay: 150 } });
    await page.getByRole('button', { name: 'Test my key' }).click();
    await expect(rows(page).nth(1)).toHaveClass(/is-fail/);
    await expect(rows(page).nth(1)).toContainText('Google rejected the key');
  });

  test('an API that is not turned on is explained with what to do', async ({ page }) => {
    await openAdmin(page, 'admin-dashboard.html', {
      scenario: {
        failSuggest:
          'PERMISSION_DENIED: Places API (New) has not been used in project 1 before or it is disabled.',
      },
    });
    await page.getByRole('button', { name: 'Test my key' }).click();
    await expect(rows(page).nth(1)).toHaveClass(/is-fail/);
    await expect(rows(page).nth(1)).toContainText('Turn on "Places API (New)" in the API Library');
    await expect(
      rows(page).nth(2),
      'the other service is still tried and reported on its own',
    ).toHaveClass(/is-ok/);
  });

  test('quota and billing problems are explained', async ({ page }) => {
    await openAdmin(page, 'admin-dashboard.html', {
      scenario: { failSuggest: 'RESOURCE_EXHAUSTED: Quota exceeded' },
    });
    await page.getByRole('button', { name: 'Test my key' }).click();
    await expect(rows(page).nth(1)).toContainText('quota is used up');
  });

  test('Geocoding off is reported as its own problem, optional features aside', async ({
    page,
  }) => {
    await openAdmin(page, 'admin-dashboard.html', {
      scenario: { geocodeOk: false, failGeocode: 'REQUEST_DENIED: This API is not activated' },
    });
    await page.getByRole('button', { name: 'Test my key' }).click();
    await expect(rows(page).nth(1)).toHaveClass(/is-ok/);
    await expect(rows(page).nth(2)).toHaveClass(/is-fail/);
    await expect(rows(page).nth(2)).toContainText('Geocoding API');
  });
});

test.describe('the dashboard and settings', () => {
  test('say where things stand, what is required from Google, and what the usage is', async ({
    page,
  }) => {
    await openAdmin(page, 'admin-dashboard.html');
    await expect(page.locator('.kcpw-aa-mode')).toContainText('Preview');
    await expect(page.locator('.kcpw-aa-mode')).toContainText(
      'Customers see your checkout exactly as before',
    );
    await expect(page.locator('body')).toContainText('Maps JavaScript API');
    await expect(page.locator('body')).toContainText('Places API (New)');
    await expect(page.locator('body')).toContainText('Address Validation API');
    await expect(page.locator('body')).toContainText('Powered by Google');
    await expect(page.locator('.kcpw-aa-usage')).toContainText('18');
    await expect(page.locator('.kcpw-aa-conflicts')).toContainText('some-map-plugin');
    await expect(page.locator('.kcpw-aa-conflicts')).not.toContainText('key=');
  });

  test('going live asks first, and cancelling leaves things as they were', async ({ page }) => {
    await openAdmin(page, 'admin-dashboard.html');
    let asked = '';
    page.on('dialog', async (d) => {
      asked = d.message();
      await d.dismiss();
    });
    let submitted = false;
    await page.route('**/admin-post.php', (route) => {
      submitted = true;
      return route.abort();
    });
    await page.getByRole('button', { name: 'Go live for customers' }).click();
    await page.waitForTimeout(300);
    expect(asked).toContain('Customers will see address suggestions');
    expect(submitted, 'nothing was sent').toBe(false);
  });

  test('the saved key is never in the page, only its last four characters', async ({ page }) => {
    await openAdmin(page, 'admin-settings-general.html');
    const html = await page.content();
    expect(html.includes('test-key-0000000000000000000000'), 'the key is not printed').toBe(false);
    await expect(page.locator('#kcpw-aa-browser-key')).toHaveAttribute('placeholder', /0000$/);
  });
});
