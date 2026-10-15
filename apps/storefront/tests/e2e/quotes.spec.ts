import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { WOO_TEST } from '../support/woo-test';

/**
 * "Request a Custom Quote" (/custom-orders/). Two servers are used:
 *  - the default one has quotes OFF (the default in every deployment), so the page shows the email fallback and no form;
 *  - the WooCommerce stand-in server has them ON and talks to the kcpw-quotes STAND-IN in tests/support/mock-woo.mjs, which only logs
 *    what it is sent (the real rules live in wordpress/kcpw-quotes and are proven by its own PHP tests). The stand-in has no state a
 *    test can change: a description containing [[mock:down]] / [[mock:limited]] / [[mock:badfile]] / [[mock:error]] gets that answer,
 *    so these tests can run beside the others without disturbing them.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const scan = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target),
  }));

// A 1x1 PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}`;

async function fillValid(page: Page, overrides: { description?: string; email?: string } = {}) {
  await page.getByLabel('Your name').fill('Pat Maker');
  await page.getByLabel('Your email').fill(overrides.email ?? 'pat@example.com');
  await page.getByLabel('Kind of project').selectOption('game-case');
  await page
    .getByLabel('Describe your project')
    .fill(
      overrides.description ??
        `A case for my copy of the game, fits the board and cards. ${unique()}`,
    );
}

/** The form only accepts a submission a few seconds after the page was drawn (a robot filter). */
const afterTheMinimumWait = (page: Page) => page.waitForTimeout(5300);

async function quoteLog(request: import('@playwright/test').APIRequestContext) {
  const log = await (await request.get(`${WOO_TEST.mockUrl}/__mock/log`)).json();
  return log.quotes as {
    request: Record<string, unknown>;
    clientKey: string;
    files: { name: string; type: string; bytes: number; magic: string }[];
  }[];
}

test.describe('with quotes switched off (the default)', () => {
  test('the page explains, offers the email address, and has no form', async ({ page }) => {
    await page.goto('/custom-orders/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Request a Custom Quote' }),
    ).toBeVisible();
    await expect(page.locator('form.quote-form')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'The request form is not open yet' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'contact@kcprintworks.com' })).toHaveAttribute(
      'href',
      /^mailto:contact@kcprintworks\.com/,
    );
    await expect(
      page.getByRole('list', { name: 'How custom orders work' }).getByRole('listitem'),
    ).toHaveCount(4);
    expect(await scan(page)).toEqual([]);
  });

  test('the request address answers "not available" and stores nothing', async ({ request }) => {
    const response = await request.post('/api/quotes/', {
      multipart: { name: 'x', website: '' },
      headers: { origin: 'http://localhost:3100' },
    });
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: 'disabled' });
  });

  test('the page is indexable-safe: canonical address and a title', async ({ page }) => {
    await page.goto('/custom-orders/');
    await expect(page).toHaveTitle(/Request a Custom Quote/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/custom-orders\/$/,
    );
  });
});

test.describe('with quotes switched on', () => {
  test.use({ baseURL: WOO_TEST.url });

  test('the form has every field with a label, and a way to add pictures', async ({ page }) => {
    await page.goto('/custom-orders/');
    for (const label of [
      'Your name',
      'Your email',
      'Kind of project',
      'Game or theme',
      'Describe your project',
      'Dimensions',
      'Quantity',
      'Needed by',
      'Colors',
      'Where would it ship?',
      'Add pictures',
    ]) {
      await expect(page.getByLabel(label).first()).toBeVisible();
    }
    await expect(page.getByLabel('Quantity')).toHaveValue('1');
    await expect(page.getByRole('button', { name: 'Send my request' })).toBeVisible();
    // No payment, no price: this is only a request.
    const text = await page.locator('form.quote-form').innerText();
    expect(/card number|cvc|\$\d/i.test(text)).toBe(false);
    expect(await page.locator('form.quote-form input[name="website"]').count()).toBe(1);
  });

  test('a search with no match links here with the words filled in as the game', async ({
    page,
  }) => {
    await page.goto('/search/?q=zzyzx+quest');
    const link = page.getByRole('link', { name: /Request a Custom Quote/ }).first();
    await expect(link).toHaveAttribute('href', /\/custom-orders\/\?item=zzyzx(\+|%20)quest/);
    await link.click();
    await expect(page).toHaveURL(/\/custom-orders\/\?item=/);
    await expect(page.getByLabel('Game or theme')).toHaveValue('zzyzx quest');
  });

  test('an empty form lists every problem, focus goes to the list, and each entry goes to its field', async ({
    page,
  }) => {
    await page.goto('/custom-orders/');
    await page.getByRole('button', { name: 'Send my request' }).click();
    const summary = page.locator('.error-summary');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Please fix these before sending your request');
    const entries = summary.getByRole('link');
    expect(await entries.count()).toBeGreaterThanOrEqual(4);
    await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
    const described = await page.getByLabel('Your name').getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    await entries.first().click();
    await expect(page.getByLabel('Your name')).toBeFocused();
    expect(await scan(page)).toEqual([]);
  });

  test('the same rules as the shop: short description, bad email, a past date, links', async ({
    page,
  }) => {
    await page.goto('/custom-orders/');
    await page.getByLabel('Your name').fill('Pat Maker');
    await page.getByLabel('Your email').fill('not-an-email');
    await page.getByLabel('Kind of project').selectOption('prototype');
    await page.getByLabel('Describe your project').fill('too short');
    await page.getByLabel('Needed by').fill('2020-01-01');
    await page.getByRole('button', { name: 'Send my request' }).click();
    const summary = page.locator('.error-summary');
    await expect(summary).toContainText(/at least 20 characters/);
    await expect(summary).toContainText(/email/i);
    await page.getByLabel('Your email').fill('pat@example.com');
    await page
      .getByLabel('Describe your project')
      .fill('See http://a.example/x and http://b.example/y and http://c.example/z for the shape.');
    await page.getByRole('button', { name: 'Send my request' }).click();
    await expect(summary).toContainText(/at most 2 web addresses/i);
    await page
      .getByLabel('Describe your project')
      .fill('A case for the whole set, with room for the extra cards.');
    await page.getByRole('button', { name: 'Send my request' }).click();
    await expect(summary).toContainText(/already passed/i);
  });

  test('a good request is sent once, shows its reference number, and nothing price-like or private goes with it', async ({
    page,
    request,
  }) => {
    await page.goto('/custom-orders/');
    const note = `Please make it in two colors. ${unique()}`;
    const deadline = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    await fillValid(page, { description: `A case for a big box game with extra room. ${note}` });
    await page.getByLabel('Game or theme').fill('Ticket to Ride');
    await page.getByLabel('Dimensions').fill('12 x 12 x 3 inches');
    await page.getByLabel('Quantity').fill('3');
    await page.getByLabel('Colors').fill('Black and orange');
    await page.getByLabel('Needed by').fill(deadline);
    await page.getByLabel('Where would it ship?').fill('United States 48104');
    await afterTheMinimumWait(page);
    await page.getByRole('button', { name: 'Send my request' }).click();
    const done = page.locator('.quote-done');
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expect(done.locator('.quote-ref')).toHaveText(/^KCQ-\d{4}-[A-HJ-NP-Z2-9]{6}$/);
    await expect(done).toContainText('pat@example.com');
    await expect(page.locator('form.quote-form')).toHaveCount(0);

    const entries = (await quoteLog(request)).filter((e) =>
      String(e.request.description).includes(note),
    );
    expect(entries).toHaveLength(1);
    const sent = entries[0]!;
    expect(sent.request).toMatchObject({
      name: 'Pat Maker',
      email: 'pat@example.com',
      projectType: 'game-case',
      game: 'Ticket to Ride',
      dimensions: '12 x 12 x 3 inches',
      quantity: 3,
      colors: 'Black and orange',
      deadline,
    });
    // The visitor's address never leaves the storefront; the shop gets a keyed hash to count requests.
    expect(sent.clientKey).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(sent)).not.toMatch(/127\.0\.0\.1|::1|price|total|amount/i);
    expect(Object.keys(sent.request).sort()).toEqual(
      [
        'colors',
        'deadline',
        'description',
        'dimensions',
        'email',
        'game',
        'name',
        'projectType',
        'quantity',
        'shipTo',
      ].sort(),
    );
    expect(await scan(page)).toEqual([]);
  });

  test('the button cannot send twice: a double click makes one request', async ({
    page,
    request,
  }) => {
    await page.goto('/custom-orders/');
    const note = `double-click ${unique()}`;
    await fillValid(page, {
      description: `Double click check, please make one case only. ${note}`,
    });
    await afterTheMinimumWait(page);
    const button = page.getByRole('button', { name: 'Send my request' });
    await button.dblclick();
    await expect(page.locator('.quote-done')).toBeVisible();
    const entries = (await quoteLog(request)).filter((e) =>
      String(e.request.description).includes(note),
    );
    expect(entries).toHaveLength(1);
  });

  test('sending too soon after the page opened asks to try again, and keeps what was typed', async ({
    page,
  }) => {
    await page.goto('/custom-orders/');
    await fillValid(page);
    await page.getByRole('button', { name: 'Send my request' }).click();
    const summary = page.locator('.error-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/send it again/i);
    await expect(page.getByLabel('Your name')).toHaveValue('Pat Maker');
  });

  test('a robot that fills the hidden field is told it worked, and nothing is sent to the shop', async ({
    page,
    request,
  }) => {
    await page.goto('/custom-orders/');
    const note = `robot ${unique()}`;
    await fillValid(page, { description: `Robot test, a case for a game please. ${note}` });
    await page.evaluate(() => {
      (document.querySelector('input[name="website"]') as HTMLInputElement).value =
        'http://spam.example';
    });
    await afterTheMinimumWait(page);
    await page.getByRole('button', { name: 'Send my request' }).click();
    await expect(page.locator('.quote-done')).toBeVisible();
    const entries = (await quoteLog(request)).filter((e) =>
      String(e.request.description).includes(note),
    );
    expect(entries).toHaveLength(0);
  });

  test('the shop being down, rate limiting and a refused picture each get a clear, honest message', async ({
    page,
  }) => {
    const cases: [string, RegExp][] = [
      ['down', /could not send your request right now.*contact@kcprintworks\.com/is],
      ['limited', /too many requests/i],
      ['badfile', /pictures? could not be used/i],
      ['error', /could not send your request right now/i],
    ];
    for (const [mode, message] of cases) {
      await page.goto('/custom-orders/');
      await fillValid(page, {
        description: `Testing the ${mode} answer for the shop. [[mock:${mode}]] ${unique()}`,
      });
      await afterTheMinimumWait(page);
      await page.getByRole('button', { name: 'Send my request' }).click();
      const summary = page.locator('.error-summary');
      await expect(summary).toBeFocused();
      await expect(summary).toContainText('Your request was not sent');
      await expect(summary).toContainText(message);
      // What was typed is still there, and no confirmation was shown.
      await expect(page.getByLabel('Your name')).toHaveValue('Pat Maker');
      await expect(page.locator('.quote-done')).toHaveCount(0);
    }
  });

  test.describe('pictures', () => {
    test('a picture is listed with its size, can be removed with the keyboard, and goes to the shop as the picture it really is', async ({
      page,
      request,
    }) => {
      await page.goto('/custom-orders/');
      const note = `picture ${unique()}`;
      await fillValid(page, {
        description: `A case with a logo on the lid, see my picture. ${note}`,
      });
      await page.getByLabel('Add pictures').setInputFiles([
        { name: 'my logo (final).PNG', mimeType: 'image/png', buffer: TINY_PNG },
        { name: 'second.png', mimeType: 'image/png', buffer: TINY_PNG },
      ]);
      const list = page.getByRole('list', { name: 'Pictures to send' });
      await expect(list.getByRole('listitem')).toHaveCount(2);
      await expect(list).toContainText('my logo (final).PNG');
      await list.getByRole('button', { name: /Remove second\.png/ }).press('Enter');
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(page.getByLabel('Add pictures')).toBeFocused();
      await afterTheMinimumWait(page);
      await page.getByRole('button', { name: 'Send my request' }).click();
      await expect(page.locator('.quote-done')).toBeVisible();
      const sent = (await quoteLog(request)).find((e) =>
        String(e.request.description).includes(note),
      )!;
      expect(sent.files).toHaveLength(1);
      expect(sent.files[0]).toMatchObject({
        name: 'my logo (final).png',
        type: 'image/png',
        bytes: TINY_PNG.length,
        magic: '89504e47',
      });
    });

    test('a large photo is made smaller in the browser before it is sent, and is still a real JPEG', async ({
      page,
      request,
    }) => {
      await page.goto('/custom-orders/');
      const note = `bigphoto ${unique()}`;
      await fillValid(page, { description: `A case shaped around this big photo. ${note}` });
      // A 4000 x 3000 noisy picture, drawn in the page and exported as a JPEG: well over the size the form accepts as it is.
      const base64 = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 4000;
        canvas.height = 3000;
        const context = canvas.getContext('2d')!;
        const image = context.createImageData(4000, 3000);
        for (let i = 0; i < image.data.length; i += 4) {
          image.data[i] = (i * 7) % 256;
          image.data[i + 1] = (i * 13 + (i >> 8)) % 256;
          image.data[i + 2] = (i * 31 + (i >> 12)) % 256;
          image.data[i + 3] = 255;
        }
        context.putImageData(image, 0, 0);
        const blob: Blob = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.97),
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      });
      const original = Buffer.from(base64, 'base64');
      expect(original.length).toBeGreaterThan(2_621_440);
      await page.getByLabel('Add pictures').setInputFiles({
        name: 'IMG_0001.JPG',
        mimeType: 'image/jpeg',
        buffer: original,
      });
      const list = page.getByRole('list', { name: 'Pictures to send' });
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(list).toContainText('IMG_0001.jpg');
      await afterTheMinimumWait(page);
      await page.getByRole('button', { name: 'Send my request' }).click();
      await expect(page.locator('.quote-done')).toBeVisible();
      const sent = (await quoteLog(request)).find((e) =>
        String(e.request.description).includes(note),
      )!;
      expect(sent.files).toHaveLength(1);
      expect(sent.files[0]!.magic.startsWith('ffd8ff')).toBe(true);
      expect(sent.files[0]!.bytes).toBeLessThan(original.length / 2);
      expect(sent.files[0]!.bytes).toBeLessThan(2_621_440);
    });

    test('something that is not a picture, and too many pictures, are refused with a reason', async ({
      page,
    }) => {
      await page.goto('/custom-orders/');
      await page.getByLabel('Add pictures').setInputFiles({
        name: 'notes.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 not a picture'),
      });
      await expect(
        page.locator('#' + (await page.getByLabel('Add pictures').getAttribute('id')) + '-error'),
      ).toContainText(/not a JPEG, PNG, WebP or GIF/);
      await expect(page.getByRole('list', { name: 'Pictures to send' })).toHaveCount(0);
      const five = Array.from({ length: 5 }, (_, i) => ({
        name: `p${i}.png`,
        mimeType: 'image/png',
        buffer: TINY_PNG,
      }));
      await page.getByLabel('Add pictures').setInputFiles(five);
      await expect(page.getByText('Please attach at most 4 pictures.')).toBeVisible();
      await page.getByLabel('Add pictures').setInputFiles(five.slice(0, 4));
      await expect(
        page.getByRole('list', { name: 'Pictures to send' }).getByRole('listitem'),
      ).toHaveCount(4);
    });
  });

  for (const [label, width, height] of [
    ['phone', 375, 800],
    ['small phone', 320, 700],
    ['tablet', 768, 900],
  ] as const) {
    test(`${label} (${width}px): one column, nothing spills sideways, controls are tappable, and there are no accessibility violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/custom-orders/');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      for (const label of ['Your name', 'Your email', 'Describe your project']) {
        const box = (await page.getByLabel(label).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44 - (label === 'Describe your project' ? 0 : 0));
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const button = (await page.getByRole('button', { name: 'Send my request' }).boundingBox())!;
      expect(button.height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Send my request' }).click();
      await expect(page.locator('.error-summary')).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      expect(await scan(page)).toEqual([]);
    });
  }

  test('the whole form can be completed with the keyboard alone', async ({ page, request }) => {
    await page.goto('/custom-orders/');
    const note = `keyboard ${unique()}`;
    await page.getByLabel('Your name').focus();
    await page.keyboard.type('Kay Board');
    await page.keyboard.press('Tab');
    await page.keyboard.type('kay@example.com');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Kind of project')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Game or theme')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.type(`A custom organizer that fits all my game pieces. ${note}`);
    await afterTheMinimumWait(page);
    await page.getByRole('button', { name: 'Send my request' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.quote-done')).toBeFocused();
    const entries = (await quoteLog(request)).filter((e) =>
      String(e.request.description).includes(note),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.request.projectType).toBeTruthy();
  });

  test('the page source carries no secret and no shop address', async ({ page }) => {
    const response = await page.goto('/custom-orders/');
    const html = await response!.text();
    for (const [name, value] of [
      ['handoff secret', WOO_TEST.handoffSecret],
      ['revalidation secret', WOO_TEST.revalidateSecret],
      ['shop address', WOO_TEST.mockUrl],
    ] as const) {
      expect(html.includes(value), `${name} must not be in the page`).toBe(false);
    }
  });
});

test.describe('what search engines are told', () => {
  test('the request page is in the sitemap only when it takes requests, and a private quote page never is', async ({
    request,
  }) => {
    const on = await (await request.get(`${WOO_TEST.url}/sitemap.xml`)).text();
    expect(on.includes('/custom-orders/</loc>')).toBe(true);
    expect(on.includes('/custom-orders/quote')).toBe(false);
    const off = await (await request.get('/sitemap.xml')).text();
    expect(off.includes('/custom-orders/')).toBe(false);
  });
});
