import { expect, test, type Page } from '@playwright/test';
import { calls, config, filled, open, options, type, waitForSuggestions } from '../support/aa';

/**
 * Address autocomplete plugin: when Google or the network misbehaves, the address fields must keep working as plain text fields, the
 * customer must never see a technical error, an administrator is told what went wrong, and the plugin stops asking Google (and
 * stops costing money) once it is clear the answers will not change. Google is a stand-in whose answers each test chooses.
 */

test.use({ baseURL: undefined });

const admin = () => ({ ...config('plain'), admin: true });

/** Everything an ordinary visitor could do with the form still works. */
async function formStillWorks(page: Page) {
  const addr = page.locator('#addr');
  await addr.fill('');
  await addr.pressSequentially('99 Hand Typed Road', { delay: 10 });
  await page.locator('#city').fill('Vassar');
  await page.locator('#send').click();
  await expect(page.locator('#submitted')).toBeVisible();
  await expect(addr).toHaveValue('99 Hand Typed Road');
  await expect(page.locator('#city')).toHaveValue('Vassar');
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function usageBeacons(page: Page) {
  const bodies: string[] = [];
  await page.route('**/kcpw-aa/v1/usage', async (route) => {
    bodies.push(route.request().postData() ?? '');
    await route.fulfill({ status: 204 });
  });
  const flush = async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    return bodies.map((b) => JSON.parse(b));
  };
  return { bodies, flush };
}

test.describe('Google cannot be reached', () => {
  test('the script is blocked: the form works, nothing is shown to the customer, and Google is asked once', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const o = await open(page, 'generic', { blockGoogle: true });
    await type(page.locator('#addr'), '123 Ma');
    await page.waitForTimeout(900);
    await expect(page.locator('#kcpw-aa-dd')).toBeHidden();
    await expect(page.locator('.kcpw-aa-pill'), 'customers are told nothing technical').toHaveCount(
      0,
    );
    await page.locator('#city').click();
    await page.locator('#addr').click();
    await page.waitForTimeout(300);
    expect(o.googleLoads(), 'a failed load is remembered, not retried on every focus').toBe(1);
    await formStillWorks(page);
    expect(errors).toEqual([]);
  });

  test('an administrator is told what went wrong, in words', async ({ page }) => {
    await open(page, 'generic', { blockGoogle: true, config: admin() });
    await page.locator('#addr').click();
    const pill = page.locator('.kcpw-aa-pill');
    await expect(pill).toContainText('Address suggestions are not working on this page (script)');
    await expect(pill).toHaveAttribute('data-kind', 'problem');
    await formStillWorks(page);
  });

  test('a request that takes too long is given up on, and a later one still works', async ({
    page,
  }) => {
    await open(page, 'generic', {
      config: (c) => ({ ...c, requestTimeout: 500 }),
      scenario: { rules: [{ prefix: '123 ma', delay: 2500, results: [] }] },
    });
    await type(page.locator('#addr'), '123 Ma');
    await expect(page.locator('.kcpw-aa-msg')).toContainText('not available right now', {
      timeout: 4000,
    });
    // one slow answer is not the end: with a quick answer the next typing works again
    await page.evaluate(() => {
      window.__KCPW_G.rules = [
        {
          prefix: '456',
          results: [{ placeId: 'p_apt', main: '456 Oak Avenue #4', secondary: 'Austin, TX, USA' }],
        },
      ];
    });
    await page.locator('#addr').fill('');
    await type(page.locator('#addr'), '456 Oa');
    await waitForSuggestions(page, 1);
  });
});

test.describe('Google answers with an error', () => {
  test('the key is rejected after the script loads: suggestions stop quietly, the form works, the administrator is told', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page, 'generic', { scenario: { authFailure: true }, config: admin() });
    await page.locator('#addr').click();
    await expect(page.locator('.kcpw-aa-pill')).toContainText('(auth)');
    await page.locator('#addr').pressSequentially('123 Ma', { delay: 20 });
    await page.waitForTimeout(800);
    await expect(page.locator('#kcpw-aa-dd')).toBeHidden();
    expect((await calls(page)).suggest, 'no request is made with a rejected key').toHaveLength(0);
    await formStillWorks(page);
    expect(errors).toEqual([]);
  });

  test('an API that is not turned on: one plain sentence for the customer, then no more requests', async ({
    page,
  }) => {
    await open(page, 'generic', {
      scenario: {
        failSuggest:
          'PERMISSION_DENIED: Places API (New) has not been used in project 1 before or it is disabled.',
      },
      config: admin(),
    });
    const addr = page.locator('#addr');
    await type(addr, '123 Ma');
    const message = page.locator('.kcpw-aa-msg');
    await expect(message).toContainText(
      'Address suggestions are not available right now. Please enter your address yourself.',
    );
    await expect(message).not.toContainText('PERMISSION_DENIED');
    await expect(message).not.toContainText('project');
    await expect(page.locator('.kcpw-aa-pill')).toContainText('(api)');
    await addr.pressSequentially('i', { delay: 10 });
    await page.waitForTimeout(800);
    await addr.pressSequentially('n St', { delay: 10 });
    await page.waitForTimeout(800);
    expect((await calls(page)).suggest, 'asked once, then stopped').toHaveLength(1);
    await formStillWorks(page);
  });

  test('the owner can switch the customer-facing sentence off: then the failure is completely silent', async ({
    page,
  }) => {
    await open(page, 'generic', {
      scenario: { failSuggest: 'PERMISSION_DENIED: not enabled' },
      config: (c) => ({ ...c, fallbackNotice: false }),
    });
    await type(page.locator('#addr'), '123 Ma');
    await page.waitForTimeout(900);
    await expect(page.locator('#kcpw-aa-dd')).toBeHidden();
    await formStillWorks(page);
  });

  test('quota used up: the same, and the failure is counted as a number, not as text', async ({
    page,
  }) => {
    const beacons = await usageBeacons(page);
    await open(page, 'generic', {
      scenario: { failSuggest: 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric' },
    });
    await type(page.locator('#addr'), '123 Ma');
    await expect(page.locator('.kcpw-aa-msg')).toContainText('not available right now');
    const sent = await beacons.flush();
    expect(sent[0].e).toEqual({ quota: 1 });
    expect(sent[0].r).toBe(1);
    const text = JSON.stringify(sent);
    expect(text.includes('123'), 'what was typed is never reported').toBe(false);
    expect(Object.keys(sent[0]).sort()).toEqual(['d', 'e', 'm', 'r', 's']);
  });

  test('an unknown error is tried a few times, and then the plugin gives up for the page', async ({
    page,
  }) => {
    await open(page, 'generic', { scenario: { failSuggest: 'INTERNAL: something odd' } });
    const addr = page.locator('#addr');
    for (const text of ['123 Ma', '123 Mai', '123 Main']) {
      await addr.fill('');
      await type(addr, text);
      await page.waitForTimeout(700);
    }
    expect((await calls(page)).suggest, 'three attempts').toHaveLength(3);
    await addr.fill('');
    await type(addr, '123 Main S');
    await page.waitForTimeout(700);
    expect((await calls(page)).suggest, 'and no fourth').toHaveLength(3);
    await formStillWorks(page);
  });

  test('another plugin has already loaded an older Google Maps script: ours stands aside and says why', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.google = { maps: { version: 'old' } };
    });
    const o = await open(page, 'generic', { config: admin() });
    await page.locator('#addr').click();
    await expect(page.locator('.kcpw-aa-pill')).toContainText('(conflict)');
    expect(o.googleLoads(), 'our own copy was not loaded on top of theirs').toBe(0);
    await formStillWorks(page);
  });
});

test.describe('Google answers, but not usefully', () => {
  test('no suggestions: a plain message, the attribution stays, and typing more works', async ({
    page,
  }) => {
    await open(page, 'generic');
    const addr = page.locator('#addr');
    await type(addr, 'zzz nothing here');
    await expect(page.locator('.kcpw-aa-msg')).toContainText(
      'No suggestions. Keep typing, or enter your address yourself.',
    );
    await expect(page.locator('.kcpw-aa-attrib')).toBeVisible();
    await expect(addr).toHaveValue('zzz nothing here');
    await addr.fill('');
    await type(addr, '123 Ma');
    await waitForSuggestions(page, 2);
    await expect(page.locator('.kcpw-aa-msg')).toBeHidden();
  });

  test('the address details cannot be loaded: the chosen text stays in the field, a message appears, no other field is touched', async ({
    page,
  }) => {
    const beacons = await usageBeacons(page);
    await open(page, 'generic', { scenario: { failDetails: true } });
    await page.locator('#city').fill('Keep me');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await expect(page.locator('.kcpw-aa-msg')).toContainText(
      'We could not load that address. Please finish it yourself.',
    );
    await expect(page.locator('#addr')).toHaveValue('123 Main Street, Flint, MI, USA');
    await expect(page.locator('#city')).toHaveValue('Keep me');
    await expect(page.locator('#state')).toHaveValue('');
    await expect(page.locator('#addr')).toBeFocused();
    const sent = await beacons.flush();
    expect(sent[0].m, 'counted as one manual finish').toBe(1);
    await formStillWorks(page);
  });

  test('the address details take too long: the same', async ({ page }) => {
    await open(page, 'generic', {
      scenario: { detailsDelay: 3000 },
      config: (c) => ({ ...c, detailsTimeout: 500 }),
    });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await expect(page.locator('.kcpw-aa-msg')).toContainText('We could not load that address', {
      timeout: 4000,
    });
    await formStillWorks(page);
  });

  test('an address with almost nothing in it fills what exists and never throws', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page, 'generic', {
      scenario: {
        places: {
          p_main: { components: [], formatted: 'Somewhere Unnamed, Nowhere', lat: 1, lng: 2 },
        },
      },
    });
    await page.locator('#state').selectOption('TX');
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('#addr')).toHaveValue('Somewhere Unnamed');
    await expect(
      page.locator('#state'),
      'a state the new address does not have is cleared',
    ).toHaveValue('');
    expect(errors).toEqual([]);
  });

  test('text from Google is only ever shown as text, never as markup', async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, 'generic', {
      scenario: {
        rules: [
          {
            prefix: '123 ma',
            results: [
              {
                placeId: 'p_main',
                main: '<img src=x onerror="window.__pwned=1">123 Main',
                secondary: '<b>Flint</b>',
                matches: [{ startOffset: 0, endOffset: 12 }],
              },
            ],
          },
        ],
        places: {
          p_main: {
            components: [
              ['street_number', '1'],
              ['route', '<img src=x onerror="window.__pwned=1">'],
              ['locality', '<script>window.__pwned=1</script>'],
            ],
            formatted: '<i>x</i>',
            lat: 1,
            lng: 2,
          },
        },
      },
    });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 1);
    await expect(options(page).first()).toContainText('<img src=x');
    await options(page).first().click();
    await filled(page, 1);
    await expect(page.locator('#city')).toHaveValue('<script>window.__pwned=1</script>');
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator('#kcpw-aa-dd img, #kcpw-aa-dd script, #kcpw-aa-dd b').count()).toBe(
      0,
    );
    expect(errors).toEqual([]);
  });
});

test.describe('the plugin itself is given bad input', () => {
  test('a broken page configuration does not break the page, and says so in the console only', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    await open(page, 'generic', { config: { key: 'x', forms: 'nope' } });
    await formStillWorks(page);
    expect(errors).toEqual([]);
    expect(warnings.join(' ')).toContain('could not start');
  });

  test('a selector that is not valid CSS is skipped with a console warning and the rest still work', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const warnings: string[] = [];
    page.on('console', (m) => warnings.push(m.text()));
    await open(page, 'generic', {
      config: (c) => {
        c.forms[0].groups.unshift({
          label: 'Broken',
          scope: '',
          fields: {
            address: '#addr[',
            address2: '',
            city: '',
            state: '',
            postcode: '',
            country: '',
          },
        });
        return c;
      },
    });
    await type(page.locator('#addr'), '123 Ma');
    await waitForSuggestions(page, 2);
    expect(errors).toEqual([]);
    expect(warnings.join(' ')).toContain('is not valid and was skipped');
  });

  test('a field that is hidden, disabled or read-only is left alone', async ({ page }) => {
    for (const id of ['ro', 'off', 'hid']) {
      await open(page, 'generic', {
        config: (c) => ({
          ...c,
          forms: [
            {
              ...c.forms[0],
              groups: [
                {
                  ...c.forms[0].groups[0],
                  fields: { ...c.forms[0].groups[0].fields, address: `#${id}` },
                },
              ],
            },
          ],
        }),
      });
      await page.waitForTimeout(300);
      await expect(page.locator(`#${id}`), id).not.toHaveAttribute('role', 'combobox');
    }
  });
});
