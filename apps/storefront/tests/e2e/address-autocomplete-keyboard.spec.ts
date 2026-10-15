import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { calls, filled, list, open, options, type, waitForSuggestions } from '../support/aa';

/**
 * Address autocomplete plugin: keyboard operation, screen reader announcements and WCAG 2.2 AA scans of the open list, in the light and
 * dark list, left-to-right and right-to-left, at desktop and phone width. Pages and Google are stand-ins (see tests/support/aa.ts).
 */

test.use({ baseURL: undefined });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

test.describe('keyboard', () => {
  test('arrow keys move through the suggestions, wrap around, and keep the screen reader pointed at the active one', async ({
    page,
  }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await expect(addr).not.toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.press('ArrowDown');
    await expect(addr).toHaveAttribute('aria-activedescendant', 'kcpw-aa-opt-0');
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(addr).toHaveAttribute('aria-activedescendant', 'kcpw-aa-opt-1');
    await page.keyboard.press('ArrowDown');
    await expect(addr, 'wraps to the first').toHaveAttribute(
      'aria-activedescendant',
      'kcpw-aa-opt-0',
    );
    await page.keyboard.press('ArrowUp');
    await expect(addr, 'and back to the last').toHaveAttribute(
      'aria-activedescendant',
      'kcpw-aa-opt-1',
    );
    await expect(page.locator('#kcpw-aa-listbox [aria-selected="true"]')).toHaveCount(1);
    await expect(addr, 'the typing focus never leaves the field').toBeFocused();
  });

  test('Enter chooses the active suggestion without submitting the form, and focus stays in the field', async ({
    page,
  }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await filled(page, 1);
    await expect(page.locator('#city')).toHaveValue('Dallas');
    await expect(page.locator('#submitted')).toBeHidden();
    await expect(addr).toBeFocused();
    await expect(addr).toHaveAttribute('aria-expanded', 'false');
  });

  test('Enter with nothing chosen is left alone, so it still submits the form as usual', async ({
    page,
  }) => {
    await open(page, 'generic');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await page.keyboard.press('Enter');
    await expect(page.locator('#submitted')).toBeVisible();
  });

  test('Escape closes the list and keeps what was typed; with the list closed Escape is not swallowed', async ({
    page,
  }) => {
    await open(page, 'generic');
    await page.evaluate(() => {
      window.__escapes = 0;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.__escapes += 1;
      });
    });
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#kcpw-aa-dd')).toBeHidden();
    await expect(addr).toHaveValue('123 Ma');
    await expect(addr).toBeFocused();
    expect(
      await page.evaluate(() => window.__escapes),
      'a dialog around the form would not be closed by the same key press',
    ).toBe(0);
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(() => window.__escapes),
      'with the list closed the key goes where it would have gone',
    ).toBe(1);
  });

  test('ArrowDown reopens the list for the same text without asking Google again', async ({
    page,
  }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#kcpw-aa-dd')).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#kcpw-aa-dd')).toBeVisible();
    expect((await calls(page)).suggest).toHaveLength(1);
  });

  test('Tab leaves the field, closes the list, and is never trapped', async ({ page }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await page.keyboard.press('Tab');
    await expect(page.locator('#addr2')).toBeFocused();
    await expect(page.locator('#kcpw-aa-dd')).toBeHidden();
    await page.keyboard.press('Shift+Tab');
    await expect(addr).toBeFocused();
  });

  test('typing again after arrowing starts from no active row, and Backspace behaves normally', async ({
    page,
  }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await page.keyboard.press('ArrowDown');
    await addr.press('Backspace');
    await expect(addr).toHaveValue('123 M');
    await expect(addr).not.toHaveAttribute('aria-activedescendant', /.+/);
  });

  test('moving the pointer over a row marks it active, and clicking it chooses it', async ({
    page,
  }) => {
    await open(page, 'generic');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).nth(1).hover();
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await options(page).nth(1).click();
    await filled(page, 1);
    await expect(page.locator('#city')).toHaveValue('Dallas');
  });
});

test.describe('screen reader announcements', () => {
  test('say how many suggestions there are, then that the address was filled in', async ({
    page,
  }) => {
    await open(page, 'generic');
    const live = page.locator('.kcpw-aa-live');
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await expect(live).toContainText('2 address suggestions available');
    await options(page).first().click();
    await filled(page, 1);
    await expect(live).toContainText('Address filled in. Please check each field.');
  });

  test('say so when there are no suggestions, in words (not only by an empty list)', async ({
    page,
  }) => {
    await open(page, 'generic');
    await type(page.locator('#addr'), 'zzz nothing');
    await expect(page.locator('.kcpw-aa-msg')).toContainText('No suggestions');
    await expect(page.locator('.kcpw-aa-live')).toContainText('No suggestions');
  });
});

for (const [label, opts] of [
  ['light list, desktop', { width: 1280 }],
  ['light list, phone', { width: 375 }],
  ['dark list on a dark page', { width: 1280, dark: true }],
  ['right-to-left page', { width: 1280, rtl: true }],
] as const) {
  test.describe(`accessibility scan: ${label}`, () => {
    test('with the suggestions open: no violations (WCAG 2.2 AA)', async ({ page }) => {
      await open(page, 'generic', opts);
      await type(page.locator('#addr'), '123 Ma');
      await waitForSuggestions(page, 2);
      await page.keyboard.press('ArrowDown');
      expect(await scan(page)).toEqual([]);
    });

    test('with the "no suggestions" message open: no violations', async ({ page }) => {
      await open(page, 'generic', opts);
      await type(page.locator('#addr'), 'zzz nothing');
      await expect(page.locator('.kcpw-aa-msg')).toBeVisible();
      expect(await scan(page)).toEqual([]);
    });
  });
}

test.describe('theme matching', () => {
  test('the list follows the page: light on a light form, dark on a dark form', async ({
    page,
  }) => {
    await open(page, 'generic');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await expect(page.locator('#kcpw-aa-dd')).toHaveAttribute('data-theme', 'light');
    const dark = await page.context().newPage();
    await open(dark, 'generic', { dark: true });
    await type(dark.locator('#addr'), '123 Ma');
    await waitForSuggestions(dark, 2);
    await expect(dark.locator('#kcpw-aa-dd')).toHaveAttribute('data-theme', 'dark');
    const bg = await dark
      .locator('#kcpw-aa-dd')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(31, 35, 40)');
  });

  test('an owner who chose "always dark" gets a dark list on a light page', async ({ page }) => {
    await open(page, 'generic', {
      config: (c) => ({ ...c, style: { ...c.style, theme: 'dark' } }),
    });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await expect(page.locator('#kcpw-aa-dd')).toHaveAttribute('data-theme', 'dark');
  });

  test("right-to-left: the list takes the field's direction and stays inside the screen", async ({
    page,
  }) => {
    await open(page, 'generic', { rtl: true, width: 375 });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await expect(page.locator('#kcpw-aa-dd')).toHaveAttribute('dir', 'rtl');
    const box = (await page.locator('#kcpw-aa-dd').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });

  test('the list flips above the field when there is no room below it', async ({ page }) => {
    await open(page, 'generic', { height: 330 });
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    const field = (await addr.boundingBox())!;
    const box = (await page.locator('#kcpw-aa-dd').boundingBox())!;
    expect(box.y + box.height, 'above the field, not under the bottom edge').toBeLessThanOrEqual(
      field.y + 2,
    );
    expect(box.y, 'and inside the screen').toBeGreaterThanOrEqual(0);
  });
});

test('the list is dismissed when focus leaves the field for something else, and never covers the field', async ({
  page,
}) => {
  await open(page, 'generic');
  const addr = page.locator('#addr');
  await type(addr, '123 Ma');
  await waitForSuggestions(page, 2);
  const field = (await addr.boundingBox())!;
  const box = (await page.locator('#kcpw-aa-dd').boundingBox())!;
  expect(box.y, 'under the field').toBeGreaterThanOrEqual(field.y + field.height - 1);
  await page.locator('#name').click();
  await expect(list(page)).toBeHidden();
});
