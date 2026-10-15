import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { calls, config, filled, open, options, type, waitForSuggestions } from '../support/aa';

/**
 * Address autocomplete plugin, the optional features: PO box notice, address check, "Use my location", the map window and the opt-in
 * location hint / checkout count. Each is off unless the owner switched it on; each must stay out of the way of the page when it is
 * off, fail quietly when it cannot work, and never get between a customer and the Place Order button.
 *
 * Pages, Google and this site's REST answers are stand-ins (see tests/support/aa.ts): they prove the plugin's behavior, not that a
 * real Google project, a real server key or a real WordPress accepts these calls.
 */

test.use({ baseURL: undefined });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FLINT = { latitude: 43.0125, longitude: -83.6875 };

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

const modulesPlain = () => config('modules-plain');
const withScenario = { scenario: { geocodeOk: true } };

/** Types an address into the plain form's fields the way a person does, leaving each field (so "change" fires). */
async function typeAddress(page: Page) {
  await page.locator('#addr').fill('123 Main Street');
  await page.locator('#city').fill('Flint');
  await page.locator('#state').selectOption('MI');
  await page.locator('#zip').fill('48502');
}

test.describe('nothing optional is loaded unless it is switched on', () => {
  test('the default setup has no extra buttons, no extra files, no extra requests', async ({
    page,
  }) => {
    const o = await open(page, 'generic');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    expect(o.moduleFiles).toEqual([]);
    expect(o.rest).toEqual([]);
    await expect(page.locator('.kcpw-aa-tools')).toHaveCount(0);
    await expect(page.locator('.kcpw-aa-notes')).toHaveCount(0);
  });

  test('with everything on: two buttons are drawn at once, the code behind them waits for a click', async ({
    page,
  }) => {
    const o = await open(page, 'generic', { config: modulesPlain() });
    await expect(page.locator('.kcpw-aa-tool')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose on a map' })).toBeVisible();
    expect(o.moduleFiles, 'no file before the visitor does anything').toEqual([]);
    expect(await page.evaluate(() => Boolean(window.google))).toBe(false);

    // Focusing the address field loads only the features that watch what is typed; the GPS and map code still wait.
    await page.locator('#addr').focus();
    await expect.poll(() => o.moduleFiles.length).toBe(2);
    expect(o.moduleFiles.sort()).toEqual(['js/kcpw-aa-pobox.js', 'js/kcpw-aa-validate.js']);
  });

  test('a feature a form does not use is not even offered to that form', async ({ page }) => {
    const o = await open(page, 'generic', {
      config: () => {
        const cfg = modulesPlain();
        cfg.forms[0].features = { map_picker: false, gps: true, validation: false, pobox: false };
        return cfg;
      },
    });
    await expect(page.locator('.kcpw-aa-tool')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
    await page.locator('#addr').focus();
    await page.waitForTimeout(300);
    expect(o.moduleFiles).toEqual([]);
  });

  test('tools sit between the address field and the next one in the tab order', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain() });
    await page.locator('#addr').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Choose on a map' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#addr2')).toBeFocused();
  });
});

test.describe('PO box and military address notice', () => {
  test('a PO box is warned about, linked to the field, and the form still goes through', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain() });
    const addr = page.locator('#addr');
    await type(addr, 'PO Box 1234');
    const note = page.locator('.kcpw-aa-note[data-kind="warn"]');
    await expect(note).toContainText('This looks like a PO box. Please check that we can deliver');
    const notes = page.locator('.kcpw-aa-notes');
    await expect(notes).toHaveAttribute('aria-live', 'polite');
    const id = await notes.getAttribute('id');
    expect(await addr.getAttribute('aria-describedby')).toContain(id);

    await page.locator('#send').click();
    await expect(page.locator('#submitted'), 'a notice never stops the form').toBeVisible();

    await addr.fill('12 Main Street');
    await expect(page.locator('.kcpw-aa-note')).toHaveCount(0);
    expect(await addr.getAttribute('aria-describedby')).toBeNull();
  });

  test('the second line counts too, and a military address gets its own sentence', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain() });
    await page.locator('#addr').fill('Unit 2050 Box 4190');
    await page.locator('#addr2').fill('APO AE 09810');
    await expect(page.locator('.kcpw-aa-note')).toContainText('military (APO/FPO) address');
    await page.locator('#addr2').fill('PO Box 9');
    await expect(page.locator('.kcpw-aa-note')).toContainText('PO box');
  });

  test('when the owner chose to block, the words say so (the server does the refusing, not this script)', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: () => ({ ...modulesPlain(), poboxMode: 'block' }),
    });
    await type(page.locator('#addr'), 'P.O. Box 55');
    await expect(page.locator('.kcpw-aa-note[data-kind="error"]')).toContainText(
      'We can only deliver to a street address',
    );
    await page.locator('#send').click();
    await expect(page.locator('#submitted')).toBeVisible();
  });

  test('street names that merely look similar are left alone', async ({ page }) => {
    await open(page, 'generic', { config: modulesPlain() });
    for (const street of ['123 Poplar Street', 'Boxwood Lane 5', '45 Apo Road']) {
      await page.locator('#addr').fill(street);
      await page.waitForTimeout(350);
      await expect(page.locator('.kcpw-aa-note'), street).toHaveCount(0);
    }
  });

  test('choosing a suggestion that is a PO box is warned about as well', async ({ page }) => {
    await open(page, 'generic', {
      config: modulesPlain(),
      scenario: {
        places: {
          p_box: {
            components: [
              ['route', 'PO Box 77'],
              ['locality', 'Flint'],
              ['administrative_area_level_1', 'Michigan', 'MI'],
              ['country', 'United States', 'US'],
              ['postal_code', '48501'],
            ],
            formatted: 'PO Box 77, Flint, MI 48501, USA',
            lat: 43,
            lng: -83.6,
          },
        },
        rules: [
          {
            prefix: 'po box',
            results: [{ placeId: 'p_box', main: 'PO Box 77', secondary: 'Flint, MI, USA' }],
          },
        ],
      },
    });
    await type(page.locator('#addr'), 'PO Box 7');
    await waitForSuggestions(page, 1);
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('#addr')).toHaveValue('PO Box 77');
    await expect(page.locator('.kcpw-aa-note')).toContainText('PO box');
  });
});

test.describe('address check', () => {
  test('a chosen address is checked once, with only the address parts, and the answer is shown', async ({
    page,
  }) => {
    const o = await open(page, 'generic', {
      config: modulesPlain(),
      rest: { validate: () => ({ status: 200, body: { verdict: 'ok', reason: 'confirmed' } }) },
    });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('.kcpw-aa-note[data-kind="ok"]')).toContainText(
      'This address looks right.',
    );
    const checks = o.rest.filter((r) => r.name === 'validate');
    expect(checks).toHaveLength(1);
    expect(JSON.parse(checks[0]!.body)).toEqual({
      regionCode: 'US',
      postalCode: '48502',
      administrativeArea: 'MI',
      locality: 'Flint',
      addressLines: ['123 Main Street'],
      formId: 'f_plainform',
    });
    expect(checks[0]!.headers['x-wp-nonce'], 'a customer holds no nonce').toBeUndefined();
    expect(checks[0]!.method).toBe('POST');
  });

  test('each kind of answer has its own plain sentence, and "unknown" says nothing', async ({
    page,
  }) => {
    const answers = [
      { verdict: 'check', reason: 'unconfirmed' },
      { verdict: 'bad', reason: 'not_found' },
      { verdict: 'unknown', reason: 'network' },
    ];
    let n = 0;
    const o = await open(page, 'generic', {
      config: modulesPlain(),
      rest: { validate: () => ({ status: 200, body: answers[n++ % answers.length] }) },
    });
    await typeAddress(page);
    await page.locator('#zip').blur();
    await expect(page.locator('.kcpw-aa-note[data-kind="warn"]')).toContainText(
      'Please double-check this address.',
    );
    await page.locator('#zip').fill('48503');
    await page.locator('#zip').blur();
    await expect(page.locator('.kcpw-aa-note[data-kind="warn"]')).toContainText(
      'We could not verify this address.',
    );
    await page.locator('#zip').fill('48504');
    await page.locator('#zip').blur();
    await expect(page.locator('.kcpw-aa-note')).toHaveCount(0);
    expect(o.rest.filter((r) => r.name === 'validate')).toHaveLength(3);
    await page.locator('#send').click();
    await expect(page.locator('#submitted'), 'advice never blocks').toBeVisible();
  });

  test('an unchanged address is not sent again, and one page cannot make more than six checks', async ({
    page,
  }) => {
    const o = await open(page, 'generic', {
      config: modulesPlain(),
      rest: { validate: () => ({ status: 200, body: { verdict: 'ok', reason: 'confirmed' } }) },
    });
    await typeAddress(page);
    await page.locator('#zip').blur();
    await expect.poll(() => o.rest.filter((r) => r.name === 'validate').length).toBe(1);
    await page.locator('#city').fill('Flint');
    await page.locator('#city').blur();
    await page.waitForTimeout(1200);
    expect(
      o.rest.filter((r) => r.name === 'validate'),
      'same address, same answer',
    ).toHaveLength(1);
    for (let i = 0; i < 9; i += 1) {
      await page.locator('#zip').fill(`4850${i}`);
      await page.locator('#zip').blur();
      await page.waitForTimeout(1000);
    }
    expect(o.rest.filter((r) => r.name === 'validate').length).toBeLessThanOrEqual(6);
  });

  test('too little to judge sends nothing (no street, no country, or no town or ZIP)', async ({
    page,
  }) => {
    const o = await open(page, 'generic', { config: modulesPlain() });
    await page.locator('#addr').fill('12');
    await page.locator('#addr').blur();
    await page.locator('#addr').fill('123 Main Street');
    await page.locator('#addr').blur();
    await page.waitForTimeout(1300);
    expect(o.rest.filter((r) => r.name === 'validate')).toHaveLength(0);
  });

  test('a server error, a refusal or a dead network leave the form exactly as it was', async ({
    page,
  }) => {
    for (const status of [500, 403, 429]) {
      const p = await page.context().newPage();
      const errors: string[] = [];
      p.on('pageerror', (e) => errors.push(e.message));
      const o = await open(p, 'generic', {
        config: modulesPlain(),
        rest: { validate: () => ({ status, body: { code: 'x' } }) },
      });
      await typeAddress(p);
      await p.locator('#zip').blur();
      await expect.poll(() => o.rest.filter((r) => r.name === 'validate').length).toBe(1);
      await p.waitForTimeout(300);
      await expect(p.locator('.kcpw-aa-note'), `status ${status}`).toHaveCount(0);
      await p.locator('#send').click();
      await expect(p.locator('#submitted')).toBeVisible();
      expect(errors).toEqual([]);
      await p.close();
    }
    const dead = await page.context().newPage();
    await dead.route('**/kcpw-aa/v1/validate', (route) => route.abort('failed'));
    await open(dead, 'generic', { config: modulesPlain() });
    await typeAddress(dead);
    await dead.locator('#zip').blur();
    await dead.waitForTimeout(1400);
    await expect(dead.locator('.kcpw-aa-note')).toHaveCount(0);
    await dead.close();
  });

  test('an administrator in preview sends the REST nonce; the page of a customer never holds one', async ({
    page,
  }) => {
    const o = await open(page, 'block', {
      config: config('modules-preview'),
      rest: { validate: () => ({ status: 200, body: { verdict: 'ok', reason: 'confirmed' } }) },
    });
    await page.locator('#shipping-address_1').fill('123 Main Street');
    await page.locator('#shipping-city').fill('Flint');
    await page.locator('#shipping-postcode').fill('48502');
    await page.locator('#shipping-postcode').blur();
    await expect.poll(() => o.rest.filter((r) => r.name === 'validate').length).toBe(1);
    expect(o.rest.find((r) => r.name === 'validate')?.headers['x-wp-nonce']).toBe('nonce-wp_rest');
    const live = config('modules-block');
    expect(JSON.stringify(live).includes('nonce')).toBe(false);
  });
});

test.describe('use my location', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: FLINT,
  });

  test('nothing asks for the position until the button is pressed; then the form is filled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __geoAsked: number };
      w.__geoAsked = 0;
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args) => {
        w.__geoAsked += 1;
        return original(...args);
      };
    });
    const o = await open(page, 'generic', { config: modulesPlain(), ...withScenario });
    await page.locator('#addr').focus();
    await type(page.locator('#addr'), 'x');
    expect(
      await page.evaluate(() => (window as unknown as { __geoAsked: number }).__geoAsked),
    ).toBe(0);
    expect(o.moduleFiles.includes('js/kcpw-aa-gps.js')).toBe(false);

    await page.getByRole('button', { name: 'Use my location' }).click();
    await filled(page, 1);
    await expect(page.locator('#addr')).toHaveValue('123 Main Street');
    await expect(page.locator('#city')).toHaveValue('Flint');
    await expect(page.locator('#zip')).toHaveValue('48502');
    await expect(page.locator('#state')).toHaveValue('MI');
    expect(
      await page.evaluate(() => (window as unknown as { __geoAsked: number }).__geoAsked),
    ).toBe(1);
    const seen = await calls(page);
    expect(seen.geocode).toHaveLength(1);
    expect(seen.geocode[0]!.location?.lat).toBeCloseTo(FLINT.latitude, 3);
    // The position went to Google's geocoder in the browser and nowhere else.
    for (const request of o.rest) {
      expect(request.body.includes('43.01'), request.name).toBe(false);
      expect(request.body.includes('83.68'), request.name).toBe(false);
    }
  });

  test('after a fix, suggestions favor places near the visitor', async ({ page }) => {
    await open(page, 'generic', { config: modulesPlain(), ...withScenario });
    await page.getByRole('button', { name: 'Use my location' }).click();
    await filled(page, 1);
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    const last = (await calls(page)).suggest.at(-1);
    expect(last?.locationBias?.center.lat).toBeCloseTo(FLINT.latitude, 3);
    expect(last?.locationBias?.radius).toBe(50000);
  });

  test('a place that is not an address (only a town) is not put in the form', async ({ page }) => {
    await open(page, 'generic', {
      config: modulesPlain(),
      scenario: { geocodeOk: true, geocodeTypes: ['locality'] },
    });
    await page.locator('#city').fill('Mine');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('.kcpw-aa-note')).toContainText('We could not turn your location');
    await expect(page.locator('#city')).toHaveValue('Mine');
    await expect(page.locator('#addr')).toHaveValue('');
  });

  test('Google refusing the lookup is explained kindly and the form is untouched', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: modulesPlain(),
      scenario: { geocodeOk: true, failGeocode: 'REQUEST_DENIED' },
    });
    await page.locator('#city').fill('Mine');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('.kcpw-aa-note[data-kind="warn"]')).toContainText(
      'We could not turn your location into an address.',
    );
    await expect(page.locator('#city')).toHaveValue('Mine');
    await expect(page.getByRole('button', { name: 'Use my location' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  test('no result at that position leaves the form alone', async ({ page }) => {
    await open(page, 'generic', { config: modulesPlain(), scenario: { geocodeOk: false } });
    await page.locator('#city').fill('Mine');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('.kcpw-aa-note')).toContainText('We could not turn your location');
    await expect(page.locator('#city')).toHaveValue('Mine');
  });
});

test.describe('use my location: permission refused', () => {
  test.use({ permissions: [] });

  test('the visitor is told they can type, and nothing is filled or sent', async ({ page }) => {
    const o = await open(page, 'generic', { config: modulesPlain(), ...withScenario });
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('.kcpw-aa-note[data-kind="warn"]')).toContainText(
      'You can type your address instead.',
    );
    expect((await calls(page)).geocode).toHaveLength(0);
    await expect(page.locator('#addr')).toHaveValue('');
    expect(o.rest.filter((r) => r.name === 'validate')).toHaveLength(0);
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
  });
});

test.describe('choose on a map', () => {
  test('opens a labelled window, a click places the pin, the address is read once and can be used', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain(), ...withScenario });
    const button = page.getByRole('button', { name: 'Choose on a map' });
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Choose your address on the map' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-standin-map]')).toBeVisible();
    const use = dialog.getByRole('button', { name: 'Use this address' });
    await expect(use, 'nothing to use before a spot is chosen').toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await dialog.locator('[data-standin-map]').click({ position: { x: 120, y: 90 } });
    await expect(dialog.getByRole('status')).toContainText(
      'Pin is near: 123 Main Street, Flint, MI 48502, USA',
    );
    expect((await calls(page)).geocode).toHaveLength(1);
    await expect(use).toHaveAttribute('aria-disabled', 'false');
    await use.click();
    await filled(page, 1);
    await expect(dialog).toBeHidden();
    await expect(page.locator('#addr')).toHaveValue('123 Main Street');
    await expect(page.locator('#zip')).toHaveValue('48502');
    await expect(button, 'focus returns to the button that opened it').toBeFocused();
  });

  test('keyboard only: Escape closes, the arrow buttons move the pin one step, and the pin can be dragged', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain(), ...withScenario });
    await page.getByRole('button', { name: 'Choose on a map' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveText('');

    await dialog.getByRole('button', { name: 'Move pin north' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await calls(page)).geocode.length).toBe(1);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await calls(page)).geocode.length).toBe(2);
    const [first, second] = (await calls(page)).geocode;
    expect(second!.location!.lat).toBeGreaterThan(first!.location!.lat);
    await dialog.getByRole('button', { name: 'Move pin east' }).focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await calls(page)).geocode.length).toBe(3);
    expect((await calls(page)).geocode[2]!.location!.lng).toBeGreaterThan(second!.location!.lng);

    await page.evaluate(() => window.__KCPW_G.dragMarker?.(43.1, -83.5));
    await expect.poll(async () => (await calls(page)).geocode.length).toBe(4);
    expect((await calls(page)).geocode[3]!.location?.lat).toBeCloseTo(43.1, 4);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Choose on a map' })).toBeFocused();
    await expect(page.locator('#addr'), 'closing changes nothing').toHaveValue('');
  });

  test('the number of lookups per opening is capped, so a busy hand cannot run up a bill', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain(), ...withScenario });
    await page.getByRole('button', { name: 'Choose on a map' }).click();
    const dialog = page.getByRole('dialog');
    const north = dialog.getByRole('button', { name: 'Move pin north' });
    for (let i = 0; i < 14; i += 1) await north.click();
    expect((await calls(page)).geocode).toHaveLength(10);
    await expect(dialog.getByRole('status')).toContainText('paused');
    await expect(dialog.getByRole('button', { name: 'Use this address' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await dialog.getByRole('button', { name: 'Close the map' }).click();
    await page.getByRole('button', { name: 'Choose on a map' }).click();
    await north.click();
    expect((await calls(page)).geocode, 'a fresh opening has a fresh allowance').toHaveLength(11);
  });

  test('a spot with no address says so and cannot be used', async ({ page }) => {
    await open(page, 'generic', { config: modulesPlain(), scenario: { geocodeOk: false } });
    await page.getByRole('button', { name: 'Choose on a map' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[data-standin-map]').click({ position: { x: 50, y: 50 } });
    await expect(dialog.getByRole('status')).toContainText('There is no address at the pin');
    await expect(dialog.getByRole('button', { name: 'Use this address' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('a map that cannot be built says so, can be closed, and typing still works', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain(), scenario: { mapFails: true } });
    await page.getByRole('button', { name: 'Choose on a map' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('status')).toContainText('The map could not be loaded');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
  });

  test('Google blocked: the same plain message', async ({ page }) => {
    await open(page, 'generic', { config: modulesPlain(), blockGoogle: true });
    await page.getByRole('button', { name: 'Choose on a map' }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText(
      'The map could not be loaded',
    );
  });

  test('the map starts where the form says it ships (a known country) rather than on the whole world', async ({
    page,
  }) => {
    await open(page, 'generic', { config: modulesPlain(), ...withScenario });
    await page.getByRole('button', { name: 'Choose on a map' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const options = await page.evaluate(
      () =>
        (window.__KCPW_G as unknown as { calls: { mapOptions: { zoom: number } } }).calls
          .mapOptions,
    );
    expect(options.zoom).toBe(4);
  });
});

test.describe('choose on a map: phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 700 } });

  test('fills the screen, nothing scrolls sideways, every control is at least 44px, and a tap places the pin', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: modulesPlain(),
      ...withScenario,
      width: 375,
      height: 700,
    });
    await page.getByRole('button', { name: 'Choose on a map' }).tap();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(375);
    expect(box.height).toBeLessThanOrEqual(700);
    for (const button of await dialog.getByRole('button').all()) {
      const b = (await button.boundingBox())!;
      expect(b.height, await button.innerText()).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await dialog.locator('[data-standin-map]').tap({ position: { x: 100, y: 80 } });
    await expect(dialog.getByRole('status')).toContainText('Pin is near');
    await dialog.getByRole('button', { name: 'Use this address' }).tap();
    await filled(page, 1);
    await expect(page.locator('#city')).toHaveValue('Flint');
  });
});

test.describe('opt-in location hint and checkout count', () => {
  test('without the opt-ins the page makes neither request', async ({ page }) => {
    const o = await open(page, 'generic', {
      config: () => ({ ...modulesPlain(), hint: false, countCheckouts: false }),
    });
    await page.locator('#addr').focus();
    await page.waitForTimeout(400);
    expect(o.rest.filter((r) => r.name === 'hint' || r.name === 'checkout-start')).toEqual([]);
  });

  test('the checkout count is one small request per page, however many fields are used', async ({
    page,
  }) => {
    const o = await open(page, 'generic', { config: modulesPlain() });
    await page.locator('#addr').focus();
    await page.locator('#addr2').focus();
    await page.locator('#addr').focus();
    await expect.poll(() => o.rest.filter((r) => r.name === 'checkout-start').length).toBe(1);
    await page.waitForTimeout(300);
    const starts = o.rest.filter((r) => r.name === 'checkout-start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.body).toBe('{}');
    expect(starts[0]!.method).toBe('POST');
  });

  test('a country hint softens the ranking only where the form does not already restrict countries', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: () => {
        const cfg = modulesPlain();
        cfg.forms[0].countries = [];
        return cfg;
      },
      rest: { hint: () => ({ status: 200, body: { country: 'GB' } }) },
    });
    await page.locator('#addr').focus();
    await page.waitForTimeout(200);
    await type(page.locator('#addr'), '10 Down');
    await waitForSuggestions(page, 1);
    const last = (await calls(page)).suggest.at(-1);
    expect(last?.region).toBe('GB');
    expect(last?.regions, 'a hint never restricts').toBeUndefined();
  });

  test('a form that restricts countries ignores the hint', async ({ page }) => {
    await open(page, 'generic', {
      config: modulesPlain(),
      rest: { hint: () => ({ status: 200, body: { country: 'GB' } }) },
    });
    await page.locator('#addr').focus();
    await page.waitForTimeout(300);
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    const last = (await calls(page)).suggest.at(-1);
    expect(last?.region).toBeUndefined();
    expect(last?.regions).toEqual(['US', 'CA']);
  });

  test('a city-sized position from a lookup service becomes a soft bias, not a restriction', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: () => {
        const cfg = modulesPlain();
        cfg.forms[0].countries = [];
        return cfg;
      },
      rest: { hint: () => ({ status: 200, body: { country: 'US', lat: 43, lng: -83.7 } }) },
    });
    await page.locator('#addr').focus();
    await page.waitForTimeout(300);
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    const last = (await calls(page)).suggest.at(-1);
    expect(last?.locationBias).toEqual({ center: { lat: 43, lng: -83.7 }, radius: 50000 });
    expect(last?.regions).toBeUndefined();
  });

  test('a broken hint answer changes nothing and breaks nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const answer of [
      { status: 500, body: { code: 'x' } },
      { status: 200, body: { country: 'Narnia' } },
      { status: 200, body: { country: 12 } },
      { status: 200, body: null },
    ]) {
      const p = await page.context().newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      await open(p, 'generic', {
        config: () => {
          const cfg = modulesPlain();
          cfg.forms[0].countries = [];
          return cfg;
        },
        rest: { hint: () => answer },
      });
      await p.locator('#addr').focus();
      await p.waitForTimeout(250);
      await type(p.locator('#addr'), '123 Ma');
      await waitForSuggestions(p, 2);
      const last = (await calls(p)).suggest.at(-1);
      expect(last?.region).toBeUndefined();
      expect(last?.locationBias).toBeUndefined();
      await p.close();
    }
    expect(errors).toEqual([]);
  });
});

test.describe('when a feature file cannot be downloaded', () => {
  test('suggestions, filling and the form are unaffected, and the buttons that cannot work are removed', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, 'generic', { config: modulesPlain(), blockModules: true, ...withScenario });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('#city')).toHaveValue('Flint');
    await expect(page.locator('.kcpw-aa-note')).toHaveCount(0);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeHidden();
    await page.getByRole('button', { name: 'Choose on a map' }).click();
    await expect(page.getByRole('button', { name: 'Choose on a map' })).toBeHidden();
    await page.locator('#send').click();
    await expect(page.locator('#submitted')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('in the WooCommerce Checkout Block', () => {
  test('the features sit under the shipping field, are not duplicated by a redraw, and leave the payment area alone', async ({
    page,
  }) => {
    const o = await open(page, 'block', {
      config: config('modules-block'),
      rest: { validate: () => ({ status: 200, body: { verdict: 'ok', reason: 'confirmed' } }) },
      ...withScenario,
    });
    await page.evaluate(() => {
      const w = window;
      w.__paymentMutations = 0;
      w.__paymentEvents = 0;
      for (const id of ['payment-stand-in', 'express-payment-stand-in']) {
        const el = document.getElementById(id)!;
        new MutationObserver((records) => {
          w.__paymentMutations += records.length;
        }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
        for (const t of ['input', 'change', 'focusin', 'click', 'keydown'])
          el.addEventListener(t, () => (w.__paymentEvents += 1), true);
      }
    });
    await expect(page.locator('.kcpw-aa-tools')).toHaveCount(1);
    await page.locator('#shipping-country').selectOption('CA');
    await page.locator('#shipping-country').selectOption('US');
    await expect(
      page.locator('.kcpw-aa-tools'),
      'no duplicate after the form is redrawn',
    ).toHaveCount(1);

    await type(page.locator('#shipping-address_1'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('#shipping-city')).toHaveValue('Flint');
    await expect(page.locator('.kcpw-aa-note[data-kind="ok"]')).toContainText('looks right');
    expect(o.rest.filter((r) => r.name === 'validate')).toHaveLength(1);

    // What the shop's own state (the thing shipping rates and Stripe read) holds is the filled address, not just what is on screen.
    const store = await page.evaluate(() => window.__store.shipping);
    expect(store).toMatchObject({
      city: 'Flint',
      state: 'MI',
      postcode: '48502',
      address_1: '123 Main Street',
    });
    expect(
      await page.evaluate(() => ({ m: window.__paymentMutations, e: window.__paymentEvents })),
    ).toEqual({ m: 0, e: 0 });
  });

  test('a PO box typed into the block checkout is noticed without disturbing the shop', async ({
    page,
  }) => {
    await open(page, 'block', { config: config('modules-block') });
    await page.locator('#shipping-address_1').fill('PO Box 12');
    await expect(page.locator('.kcpw-aa-note')).toContainText('PO box');
    expect(await page.evaluate(() => window.__store.shipping.address_1)).toBe('PO Box 12');
  });
});

for (const [label, opts] of [
  ['desktop', { width: 1280 }],
  ['phone', { width: 375 }],
  ['dark page', { width: 1280, dark: true }],
  ['right-to-left', { width: 1280, rtl: true }],
] as const) {
  test.describe(`accessibility scan: ${label}`, () => {
    test('tools and a warning note: no violations (WCAG 2.2 AA)', async ({ page }) => {
      await open(page, 'generic', { config: modulesPlain(), ...opts });
      await type(page.locator('#addr'), 'PO Box 1234');
      await expect(page.locator('.kcpw-aa-note')).toBeVisible();
      expect(await scan(page)).toEqual([]);
    });

    test('each kind of note: no violations', async ({ page }) => {
      await open(page, 'generic', {
        config: () => ({ ...modulesPlain(), poboxMode: 'block' }),
        ...opts,
      });
      await type(page.locator('#addr'), 'PO Box 1234');
      await expect(page.locator('.kcpw-aa-note[data-kind="error"]')).toBeVisible();
      expect(await scan(page)).toEqual([]);
      await page.evaluate(() => {
        for (const kind of ['ok', 'warn', 'info']) {
          const p = document.createElement('p');
          p.className = 'kcpw-aa-note';
          p.setAttribute('data-kind', kind);
          p.innerHTML = `<span class="kcpw-aa-note-icon" aria-hidden="true">i</span><span class="kcpw-aa-note-text">A ${kind} message</span>`;
          document.querySelector('.kcpw-aa-notes')!.appendChild(p);
        }
      });
      expect(await scan(page)).toEqual([]);
    });

    test('the open map window: no violations', async ({ page }) => {
      await open(page, 'generic', { config: modulesPlain(), ...withScenario, ...opts });
      await page.getByRole('button', { name: 'Choose on a map' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('[data-standin-map]').click({ position: { x: 60, y: 60 } });
      await expect(dialog.getByRole('status')).toContainText('Pin is near');
      expect(await scan(page)).toEqual([]);
    });
  });
}
