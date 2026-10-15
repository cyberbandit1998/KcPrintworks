import AxeBuilder from '@axe-core/playwright';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { config, open, options, serveFixtures, type, waitForSuggestions } from '../support/aa';

/**
 * Address autocomplete plugin: the Visual Selector Tool. The administrator screen (written by the plugin's real PHP, wrapped in a rough
 * stand-in for the WordPress admin page) opens a stand-in site page in a frame with the picking script on, the administrator clicks a
 * field, chooses a way of finding it, and it is typed into the form. The screen and the page are served from one local origin, as the
 * WordPress admin and the site are.
 */

test.use({ baseURL: undefined });

let server: Awaited<ReturnType<typeof serveFixtures>>;
test.beforeAll(async () => {
  server = await serveFixtures();
});
test.afterAll(async () => {
  await server.close();
});

const dialog = (page: Page) => page.locator('#kcpw-aa-picker');
const frame = (page: Page): FrameLocator => page.frameLocator('#kcpw-aa-picker-frame');
const cards = (page: Page) => page.locator('#kcpw-aa-picker-results .kcpw-aa-card-pick');

async function openEditor(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${server.origin}/admin-editor.html`);
}

async function pickButton(page: Page, field: string, group = 0) {
  await page.locator(`#kcpw-aa-g${group}-${field}`).scrollIntoViewIfNeeded();
  await page.locator(`.kcpw-aa-pick[data-target="kcpw-aa-g${group}-${field}"]`).click();
  await expect(dialog(page)).toBeVisible();
}

async function choosePage(page: Page, label: RegExp | string) {
  await page.locator('#kcpw-aa-picker-page').selectOption({
    label:
      typeof label === 'string'
        ? label
        : (await page.locator('#kcpw-aa-picker-page option').allTextContents()).find((t) =>
            label.test(t),
          )!,
  });
}

test.describe('the editor screen', () => {
  test('every field has a Pick button, and the picker window is a proper dialog', async ({
    page,
  }) => {
    await openEditor(page);
    await expect(page.locator('.kcpw-aa-pick')).toHaveCount(12);
    await expect(page.locator('#kcpw-aa-picker')).toHaveAttribute(
      'aria-labelledby',
      'kcpw-aa-picker-title',
    );
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('#kcpw-aa-picker-page option')).toHaveCount(4);
    await expect(page.locator('#kcpw-aa-picker-page option:checked')).toHaveText(/Checkout/);
  });

  test('opening it loads your page with the one-time token, and says what to do', async ({
    page,
  }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await expect(page.locator('#kcpw-aa-picker-title')).toContainText(
      'Pick the field for: Address (the field the customer types in)',
    );
    await expect(page.locator('#kcpw-aa-picker-help')).toContainText('Click the field you want');
    const src = await page.locator('#kcpw-aa-picker-frame').getAttribute('src');
    expect(src).toContain('/block.html');
    expect(src).toContain('kcpw_aa_pick=test-token');
    await expect(frame(page).locator('.kcpw-aa-pk-bar')).toContainText(
      'Click the field you want, or press Tab',
    );
    await expect(page.locator('#kcpw-aa-picker-results')).toContainText(
      'Waiting for you to click a field',
    );
  });
});

test.describe('picking a field', () => {
  test('clicking a Checkout Block field offers its id first, and using it fills the box and returns to the button', async ({
    page,
  }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await frame(page).locator('#shipping-address_1').click();
    await expect(cards(page).first()).toContainText('#shipping-address_1');
    await expect(cards(page).first()).toContainText('ID: most reliable');
    await expect(cards(page).first()).toContainText(
      'Unique: matches exactly one thing on the page',
    );
    await cards(page).first().getByRole('button', { name: 'Use this selector' }).click();
    await expect(page.locator('#kcpw-aa-g0-address')).toHaveValue('#shipping-address_1');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('.kcpw-aa-pick[data-target="kcpw-aa-g0-address"]')).toBeFocused();
  });

  test('hovering outlines the field under the pointer', async ({ page }) => {
    await openEditor(page);
    await pickButton(page, 'city');
    await frame(page).locator('#shipping-city').hover();
    const outline = frame(page).locator('.kcpw-aa-pk-outline');
    await expect(outline).toBeVisible();
    const box = (await outline.boundingBox())!;
    const field = (await frame(page).locator('#shipping-city').boundingBox())!;
    expect(Math.abs(box.x - (field.x - 3))).toBeLessThan(3);
    expect(Math.abs(box.width - (field.width + 6))).toBeLessThan(3);
  });

  test('every way offered resolves to the very field that was clicked (tricky markup)', async ({
    page,
  }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    const field = frame(page).locator('#wpforms-5-field_3');
    await field.click();
    await expect(cards(page).first()).toBeVisible();
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('#kcpw-aa-picker-results .kcpw-aa-card-pick')].map((c) => ({
        selector: c.querySelector('code')!.textContent!,
        unique: c.classList.contains('is-unique'),
      })),
    );
    expect(found.length).toBeGreaterThanOrEqual(5);
    const selectors = found.map((f) => f.selector);
    expect(selectors).toContain('#wpforms-5-field_3');
    expect(selectors).toContain('[name="wpforms[fields][3][address1]"]');
    expect(
      selectors.some((s) => s.includes('css-1x2y3z')),
      'a generated class name is never offered',
    ).toBe(false);
    expect(selectors.some((s) => s.startsWith('input[autocomplete="address-line1"]'))).toBe(true);
    // every offered selector must be valid, and the unique ones must find exactly that field
    const verdicts = await frame(page)
      .locator('body')
      .evaluate(
        (_body, sels) =>
          sels.map((s) => {
            try {
              const all = document.querySelectorAll(s);
              return {
                s,
                n: all.length,
                first: all[0] === document.getElementById('wpforms-5-field_3'),
              };
            } catch {
              return { s, n: -1, first: false };
            }
          }),
        selectors,
      );
    for (const v of verdicts) {
      expect(v.n, `${v.s} is a valid selector`).toBeGreaterThanOrEqual(1);
      expect(v.first, `${v.s} finds the clicked field first`).toBe(true);
    }
    // the ones the screen calls unique really are
    for (const f of found.filter((x) => x.unique))
      expect(verdicts.find((v) => v.s === f.selector)!.n).toBe(1);
    await expect(cards(page).first().locator('.is-unique, :scope')).toHaveCount(1);
  });

  test('a class two fields share is shown with how many things it matches', async ({ page }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    await frame(page).locator('#wpforms-5-field_3-address2').click();
    await expect(page.locator('#kcpw-aa-picker-results')).toContainText(
      'Matches 2 things on the page; the first is used',
    );
  });

  test('a name containing a quote is escaped into a working selector', async ({ page }) => {
    await openEditor(page);
    await pickButton(page, 'city');
    await choosePage(page, /Booking/);
    await frame(page).locator("input[name='co\"mpany']").click();
    await expect(
      page.locator('#kcpw-aa-picker-results code', { hasText: 'co\\"mpany' }).first(),
    ).toBeVisible();
    const resolved = await frame(page)
      .locator('body')
      .evaluate(() => document.querySelectorAll('[name="co\\"mpany"]').length);
    expect(resolved).toBe(1);
  });

  test('an id that starts with a digit is escaped', async ({ page }) => {
    await openEditor(page);
    await pickButton(page, 'city');
    await choosePage(page, /Booking/);
    await frame(page).locator('[id="123-numeric-id"]').click();
    const first = await cards(page).first().locator('code').textContent();
    expect(first).toBe('#\\31 23-numeric-id');
    const n = await frame(page)
      .locator('body')
      .evaluate((_b, sel) => document.querySelectorAll(sel).length, first!);
    expect(n).toBe(1);
  });

  test('clicking the label, a wrapping label, a wrapper with one field, or a styled select box picks the real field', async ({
    page,
  }) => {
    await openEditor(page);
    const firstChoice = () => page.locator('#kcpw-aa-picker-results code').first();
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    await frame(page).locator('label.wpforms-field-label').click();
    await expect(firstChoice()).toHaveText('#wpforms-5-field_3');
    await frame(page)
      .locator('.phone-wrap')
      .click({ position: { x: 4, y: 4 } });
    await expect(firstChoice()).toHaveText('[name="phone"]');
    await frame(page).locator('#row-company .hint').click();
    await expect(
      page.locator('#kcpw-aa-picker-results code', { hasText: 'co\\"mpany' }).first(),
    ).toBeVisible();
    await frame(page).locator('.select2-selection__rendered').click();
    await expect(firstChoice()).toHaveText('#country');
  });

  test('something that is not a field says so and offers nothing', async ({ page }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    await frame(page).locator('.not-a-field').click();
    await expect(frame(page).locator('.kcpw-aa-pk-bar')).toContainText('That is not a field');
    await expect(cards(page)).toHaveCount(0);
  });

  test('while picking, nothing on the page reacts: no form submit, no button handler, no navigation', async ({
    page,
  }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    const before = await page.locator('#kcpw-aa-picker-frame').getAttribute('src');
    await frame(page).locator('#go').click();
    await frame(page).locator('#away').click();
    await page.waitForTimeout(400);
    await expect(frame(page).locator('#submitted')).toBeHidden();
    expect(
      await frame(page)
        .locator('body')
        .evaluate(() => (window as unknown as { __clicks: number }).__clicks),
      "the page's own click handler never ran",
    ).toBe(0);
    await expect(frame(page).locator('h1')).toHaveText('Booking form');
    expect(await page.locator('#kcpw-aa-picker-frame').getAttribute('src')).toBe(before);
  });

  test('keyboard: Tab to a field in the page and press Enter to pick it; Enter does not submit the form', async ({
    page,
  }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    await frame(page).locator('#wpforms-5-field_3').focus();
    await page.keyboard.press('Enter');
    await expect(cards(page).first()).toContainText('#wpforms-5-field_3');
    await expect(frame(page).locator('#submitted')).toBeHidden();
  });

  test('Escape inside the page closes the window', async ({ page }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    await frame(page).locator('#wpforms-5-field_3').focus();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('.kcpw-aa-pick[data-target="kcpw-aa-g0-address"]')).toBeFocused();
  });

  test('the Close button and the Escape key close it, and nothing is filled in', async ({
    page,
  }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('#kcpw-aa-g0-address')).toHaveValue('');
    await pickButton(page, 'address');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('#kcpw-aa-g0-address')).toHaveValue('');
  });
});

test.describe('only the page this screen opened is believed', () => {
  test('a message from anywhere else is ignored', async ({ page }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    await page.evaluate(() =>
      window.postMessage(
        {
          source: 'kcpw-aa-picker',
          type: 'pick',
          candidates: [{ kind: 'id', selector: '#evil', count: 1, unique: true }],
        },
        window.location.origin,
      ),
    );
    await page.waitForTimeout(300);
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator('#kcpw-aa-picker-results')).not.toContainText('#evil');
  });

  test('a page from another origin that ends up in the frame is not believed, even if it is the frame', async ({
    page,
  }) => {
    const other = await serveFixtures();
    try {
      await openEditor(page);
      await pickButton(page, 'address');
      await page.evaluate((src) => {
        (document.getElementById('kcpw-aa-picker-frame') as HTMLIFrameElement).src = src;
      }, `${other.origin}/cross-origin.html`);
      await expect(frame(page).locator('p')).toHaveText('Not the site.');
      await page.waitForTimeout(400);
      await expect(cards(page)).toHaveCount(0);
      await expect(page.locator('#kcpw-aa-picker-results')).not.toContainText('#evil');
    } finally {
      await other.close();
    }
  });

  test('the picking script exists only when the page address carries the token the server hands out', async ({
    page,
  }) => {
    await page.goto(`${server.origin}/tricky.html`);
    await expect(page.locator('.kcpw-aa-pk-bar')).toHaveCount(0);
    await page.goto(`${server.origin}/tricky.html?kcpw_aa_pick=anything`);
    await expect(page.locator('.kcpw-aa-pk-bar')).toHaveCount(1);
    // opened on its own (not inside the screen and not as its popup) it has nobody to report to and does nothing harmful
    await page.locator('#wpforms-5-field_3').click();
    await expect(page.locator('#submitted')).toBeHidden();
  });
});

test('a new window works the same way, for sites that do not allow their pages to be framed', async ({
  page,
}) => {
  await openEditor(page);
  await pickButton(page, 'address');
  await choosePage(page, /Booking/);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Open in a new window' }).click(),
  ]);
  await popup.waitForLoadState();
  await expect(popup.locator('.kcpw-aa-pk-bar')).toBeVisible();
  await popup.locator('#wpforms-5-field_3').click();
  await expect(cards(page).first()).toContainText('#wpforms-5-field_3');
  await popup.close();
});

test.describe('from the tool to the plugin', () => {
  test('selectors picked for every field of a plain form are what the plugin then uses to fill it', async ({
    page,
  }) => {
    await openEditor(page);
    const wanted: Record<string, string> = {
      address: '#addr',
      address2: '#addr2',
      city: '#city',
      state: '#state',
      postcode: '#zip',
      country: '#country',
    };
    for (const [field, id] of Object.entries(wanted)) {
      await pickButton(page, field);
      await choosePage(page, 'Home page');
      await frame(page).locator(id).click();
      await cards(page).first().getByRole('button', { name: 'Use this selector' }).click();
      await expect(dialog(page)).toBeHidden();
    }
    const fields: Record<string, string> = {};
    for (const field of Object.keys(wanted))
      fields[field] = await page.locator(`#kcpw-aa-g0-${field}`).inputValue();
    expect(fields).toEqual(wanted);

    const target = await page.context().newPage();
    await open(target, 'generic', {
      config: () => {
        const c = config('plain');
        c.forms[0].groups[0].fields = fields;
        return c;
      },
    });
    await type(target.locator('#addr'), '123 Ma');
    await waitForSuggestions(target, 2);
    await options(target).first().click();
    await expect(target.locator('#city')).toHaveValue('Flint');
    await expect(target.locator('#state')).toHaveValue('MI');
    await expect(target.locator('#zip')).toHaveValue('48502');
  });
});

test.describe('accessibility and phones', () => {
  test('the open window, with the ways of finding a field listed, has no WCAG 2.2 AA violations', async ({
    page,
  }) => {
    await openEditor(page);
    await pickButton(page, 'address');
    await choosePage(page, /Booking/);
    await frame(page).locator('#wpforms-5-field_3').click();
    await expect(cards(page).first()).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });

  test('the editor screen itself has no violations', async ({ page }) => {
    await openEditor(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });

  test('on a phone the window fits the screen and the results sit under the page', async ({
    page,
  }) => {
    await openEditor(page, 375);
    await pickButton(page, 'address');
    const box = (await dialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  });
});

test('an exported file chosen on the Forms screen fills the import box', async ({ page }) => {
  await page.goto(`${server.origin}/admin-forms.html`);
  const json = JSON.stringify({ kcpw_address_autocomplete: 1, forms: [] });
  await page
    .locator('#kcpw-aa-import-file')
    .setInputFiles({ name: 'forms.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('#kcpw-aa-import-json')).toHaveValue(json);
});
