import { expect, test } from '@playwright/test';
import {
  calls,
  config,
  defaultScenario,
  list,
  open,
  options,
  type,
  waitForSuggestions,
} from '../support/aa';

/**
 * Address autocomplete plugin (wordpress/kcpw-address-autocomplete): the core behavior on a plain form, at desktop and phone width.
 * Pages are stand-ins, Google is a stand-in, the plugin's script, stylesheet and page configuration are the real ones (see
 * tests/support/aa.ts). What is not proven here: Google itself, a real WordPress, the real WooCommerce blocks.
 */

test.use({ baseURL: undefined });

for (const [label, width] of [
  ['desktop', 1280],
  ['phone', 375],
] as const) {
  test.describe(label, () => {
    test('nothing is requested from Google until a visitor clicks into the address field', async ({
      page,
    }) => {
      const o = await open(page, 'generic', { width });
      await page.waitForTimeout(700);
      expect(o.googleLoads(), 'not at page load').toBe(0);
      await page.locator('#name').click();
      await page.waitForTimeout(200);
      expect(o.googleLoads(), 'not for another field').toBe(0);
      await page.locator('#addr').click();
      await expect.poll(() => o.googleLoads()).toBe(1);
      await expect.poll(async () => (await calls(page)).loads).toBe(1);
      expect((await calls(page)).suggest.length, 'loading the script asks for no suggestions').toBe(
        0,
      );
    });

    test('typing quickly sends one request after the pause, never one per key, and never below the minimum', async ({
      page,
    }) => {
      await open(page, 'generic', { width });
      const addr = page.locator('#addr');
      await type(addr, '12');
      await page.waitForTimeout(700);
      expect(
        (await calls(page)).suggest.length,
        'two characters are below the minimum of three',
      ).toBe(0);
      await addr.pressSequentially('3 Ma', { delay: 25 });
      await waitForSuggestions(page, 2);
      const c = await calls(page);
      expect(c.suggest.map((s) => s.input)).toEqual(['123 Ma']);
      expect(c.suggest[0]!.token).toBeTruthy();
    });

    test('suggestions are an accessible list with Google attribution, and fit the screen', async ({
      page,
    }) => {
      await open(page, 'generic', { width });
      const addr = page.locator('#addr');
      await type(addr, '123 Ma');
      await waitForSuggestions(page, 2);
      await expect(addr).toHaveAttribute('role', 'combobox');
      await expect(addr).toHaveAttribute('aria-autocomplete', 'list');
      await expect(addr).toHaveAttribute('aria-expanded', 'true');
      await expect(addr).toHaveAttribute('aria-controls', 'kcpw-aa-listbox');
      await expect(list(page)).toHaveAttribute('role', 'listbox');
      await expect(options(page).first()).toContainText('123 Main Street');
      await expect(options(page).first()).toContainText('Flint, MI, USA');
      await expect(page.locator('.kcpw-aa-attrib')).toHaveText('Powered by Google');
      await expect(page.locator('.kcpw-aa-attrib')).toBeVisible();
      const box = (await page.locator('#kcpw-aa-dd').boundingBox())!;
      const field = (await addr.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'inside the screen').toBeLessThanOrEqual(width);
      expect(Math.abs(box.width - field.width), 'about as wide as the field').toBeLessThan(40);
      const row = (await options(page).first().boundingBox())!;
      expect(row.height, 'a touch-sized row').toBeGreaterThanOrEqual(44);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
      // the matched part of the text is emphasised
      await expect(options(page).first().locator('strong')).toHaveText('123 Ma');
    });

    test('choosing a suggestion fills every field', async ({ page }) => {
      await open(page, 'generic', { width });
      const addr = page.locator('#addr');
      await type(addr, '123 Ma');
      await waitForSuggestions(page, 2);
      await options(page).first().click();
      await expect(addr).toHaveValue('123 Main Street');
      await expect(page.locator('#city')).toHaveValue('Flint');
      await expect(page.locator('#state')).toHaveValue('MI');
      await expect(page.locator('#zip')).toHaveValue('48502');
      await expect(page.locator('#country')).toHaveValue('US');
      await expect(page.locator('#addr2')).toHaveValue('');
      await expect(list(page)).toBeHidden();
      await expect(addr).toBeFocused();
    });

    test('an apartment goes to line 2, in the visitor\'s own words for "unit"', async ({
      page,
    }) => {
      await open(page, 'generic', {
        width,
        config: (c) => ({ ...c, i18n: { ...c.i18n, unit: 'Apt' } }),
      });
      await type(page.locator('#addr'), '456 Oa');
      await waitForSuggestions(page, 1);
      await options(page).first().click();
      await expect(page.locator('#addr2')).toHaveValue('Apt 4');
      await expect(page.locator('#addr')).toHaveValue('456 Oak Avenue');
      await expect(page.locator('#state')).toHaveValue('TX');
    });

    test('single line mode puts the full address in the one field and touches nothing else', async ({
      page,
    }) => {
      await open(page, 'generic', {
        width,
        config: (c) => {
          c.forms[0].mode = 'single';
          return c;
        },
      });
      await page.locator('#city').fill('Keep me');
      await type(page.locator('#addr'), '123 Ma');
      await waitForSuggestions(page, 2);
      await options(page).first().click();
      await expect(page.locator('#addr')).toHaveValue('123 Main Street, Flint, MI 48502, USA');
      await expect(page.locator('#city')).toHaveValue('Keep me');
    });

    test('a different country is chosen, and a state that country does not list is cleared', async ({
      page,
    }) => {
      await open(page, 'generic', { width });
      await page.locator('#state').selectOption('MI');
      await type(page.locator('#addr'), '10 Down');
      await waitForSuggestions(page, 1);
      await options(page).first().click();
      await expect(page.locator('#country')).toHaveValue('GB');
      await expect(page.locator('#city')).toHaveValue('London');
      await expect(page.locator('#zip')).toHaveValue('SW1A 2AA');
      await expect(page.locator('#addr')).toHaveValue('10 Downing Street');
      await expect(page.locator('#state'), 'Michigan is not a UK county').toHaveValue('');
    });
  });
}

test.describe('cost behavior', () => {
  test("choosing asks Google only for the address parts, once, with the typing session's token", async ({
    page,
  }) => {
    await open(page, 'generic');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await expect(page.locator('#city')).toHaveValue('Flint');
    const c = await calls(page);
    expect(c.details.length).toBe(1);
    expect(c.details[0]!.fields).toEqual(['addressComponents', 'formattedAddress', 'location']);
    expect(c.details[0]!.token, 'the lookup belongs to the same session as the suggestions').toBe(
      c.suggest[0]!.token,
    );
  });

  test('one session token covers the whole typing session, and the next session gets a new one', async ({
    page,
  }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await addr.pressSequentially('i', { delay: 25 });
    await page.waitForTimeout(800);
    let c = await calls(page);
    expect(c.suggest.length).toBe(2);
    expect(c.suggest[1]!.token, 'the second request is in the same session').toBe(
      c.suggest[0]!.token,
    );
    await options(page).first().click();
    await expect(page.locator('#city')).toHaveValue('Flint');
    await addr.fill('');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    c = await calls(page);
    expect(c.suggest[c.suggest.length - 1]!.token, 'a new session after a choice').not.toBe(
      c.suggest[0]!.token,
    );
    expect(c.tokens).toBe(2);
  });

  test('text already answered is answered from memory, not asked again', async ({ page }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await addr.press('Backspace');
    await addr.press('Backspace');
    await page.waitForTimeout(700);
    await addr.pressSequentially('Ma', { delay: 25 });
    await page.waitForTimeout(700);
    await waitForSuggestions(page, 2);
    const asked = (await calls(page)).suggest.map((s) => s.input);
    expect(
      asked.filter((s) => s === '123 Ma'),
      'one request for the same text',
    ).toHaveLength(1);
  });

  test('an older, slower answer never replaces the answer to newer text', async ({ page }) => {
    await open(page, 'generic', {
      scenario: {
        rules: [
          {
            prefix: '123 mai',
            results: [
              { placeId: 'p_main2', main: '123 Main Street', secondary: 'Dallas, TX, USA' },
            ],
          },
          {
            prefix: '123 ma',
            delay: 1200,
            results: [
              { placeId: 'p_main', main: '123 Maple Street (old)', secondary: 'Flint, MI, USA' },
            ],
          },
        ],
      },
    });
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    await page.waitForTimeout(450);
    await addr.pressSequentially('i', { delay: 25 });
    await waitForSuggestions(page, 1);
    await expect(options(page).first()).toContainText('Dallas');
    await page.waitForTimeout(1500);
    await expect(
      options(page).first(),
      'the late answer to the older text was dropped',
    ).toContainText('Dallas');
    await expect(page.locator('body')).not.toContainText('(old)');
  });

  test('suggestions pause after the configured number of requests, and the field keeps working', async ({
    page,
  }) => {
    await open(page, 'generic', { config: (c) => ({ ...c, maxRequests: 2 }) });
    const addr = page.locator('#addr');
    for (const text of ['123 Ma', '456 Oa', '123 King']) {
      await addr.fill('');
      await type(addr, text);
      await page.waitForTimeout(650);
    }
    expect((await calls(page)).suggest.length).toBe(2);
    await expect(page.locator('.kcpw-aa-msg')).toContainText('Suggestions paused');
    await expect(addr).toHaveValue('123 King');
  });

  test('the countries, language and kind of place the owner chose are what Google is asked for', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: (c) => {
        c.forms[0].countries = ['US', 'CA', 'MX'];
        c.forms[0].language = 'es';
        c.forms[0].placeTypes = 'cities';
        return c;
      },
    });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    const s = (await calls(page)).suggest[0]!;
    expect(s.regions).toEqual(['US', 'CA', 'MX']);
    expect(s.language).toBe('es');
    expect(s.types).toEqual(['(cities)']);
  });

  test('never more than five countries are sent', async ({ page }) => {
    await open(page, 'generic', {
      config: (c) => {
        c.forms[0].countries = ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'IT'];
        return c;
      },
    });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    expect((await calls(page)).suggest[0]!.regions).toHaveLength(5);
  });

  test('the address-only filter sends the three address types; "everything" sends none', async ({
    page,
  }) => {
    await open(page, 'generic');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    expect((await calls(page)).suggest[0]!.types).toEqual([
      'street_address',
      'premise',
      'subpremise',
    ]);
    const second = await page.context().newPage();
    await open(second, 'generic', {
      config: (c) => ({ ...c, forms: [{ ...c.forms[0], placeTypes: 'all' }] }),
    });
    await type(second.locator('#addr'), '123 Ma');
    await waitForSuggestions(second, 2);
    expect((await calls(second)).suggest[0]!.types).toBeUndefined();
  });

  test('"businesses" is filtered in the browser: a street address is left out', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: (c) => ({ ...c, forms: [{ ...c.forms[0], placeTypes: 'business' }] }),
      scenario: {
        rules: [
          {
            prefix: 'joe',
            results: [
              {
                placeId: 'p_main',
                main: "Joe's Hardware",
                secondary: 'Flint, MI',
                types: ['establishment', 'point_of_interest'],
              },
              { placeId: 'p_main2', main: 'Joe Street', secondary: 'Dallas, TX', types: ['route'] },
            ],
          },
        ],
      },
    });
    await type(page.locator('#addr'), 'Joe');
    await waitForSuggestions(page, 1);
    await expect(options(page).first()).toContainText("Joe's Hardware");
  });
});

test.describe('the administrator notice', () => {
  test('is shown to administrators in preview mode, can be dismissed, and stays away after that', async ({
    page,
  }) => {
    await open(page, 'generic', { config: { ...config('plain'), admin: true, preview: true } });
    const pill = page.locator('.kcpw-aa-pill');
    await expect(pill).toContainText('preview for administrators only');
    await page.getByRole('button', { name: 'Dismiss this notice' }).click();
    await expect(pill).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.kcpw-aa-pill')).toHaveCount(0);
  });

  test('is never shown to customers', async ({ page }) => {
    await open(page, 'generic');
    await page.waitForTimeout(400);
    await expect(page.locator('.kcpw-aa-pill')).toHaveCount(0);
  });
});

test.describe('modules stay out of the way', () => {
  test('with every optional feature off, no module file is requested', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await open(page, 'generic');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    const scripts = requests.filter((u) => /kcpw-aa-(map|gps|validate|pobox|picker)/.test(u));
    expect(scripts).toEqual([]);
  });
});

test('the default scenario is what the tests think it is', () => {
  expect(Object.keys(defaultScenario().places)).toContain('p_main');
});
