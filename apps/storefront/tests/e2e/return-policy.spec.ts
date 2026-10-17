import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The Return & Exchange Policy page: public (no sign-in), reachable from every footer, and saying what the owner decided.
 * Runs on the default (fixtures) server on port 3100.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('/return-policy is public, redirects to its trailing-slash address and has the exact tab title', async ({
  page,
  request,
}) => {
  // The site keeps WooCommerce's trailing slashes, so the bare address redirects once and then answers 200 with no sign-in step.
  const bare = await request.get('/return-policy', { maxRedirects: 0 });
  expect([307, 308]).toContain(bare.status());
  expect(bare.headers()['location']).toMatch(/\/return-policy\/$/);

  const response = await page.goto('/return-policy');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/return-policy\/$/);
  await expect(page).toHaveTitle('Return & Exchange Policy | KCPrintWorks');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Return & Exchange Policy');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/return-policy\/$/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /final/i);
});

test('the page states each point of the policy', async ({ page }) => {
  await page.goto('/return-policy/');
  const main = page.locator('main');
  const text = (await main.innerText()).replace(/\s+/g, ' ');
  for (const sentence of [
    'All sales are final.',
    'We do not accept returns for a refund when you change your mind.',
    'within 30 days of delivery',
    'you pay the shipping costs in both directions',
    'cannot be exchanged if you change your mind',
    'report it within 30 days of delivery through the Contact page',
    'Include your order number and, if you can, clear photos of the product and its packaging',
    'you qualify for a free replacement at no additional charge',
    'KCPrintWorks covers all necessary shipping costs',
    'you may not need to return the original item',
    'If we cannot provide a replacement, we will offer an appropriate resolution.',
    'a refund when it is necessary or required by law',
    'The 30-day reporting window does not limit any legal rights that apply to you.',
    'before you ship anything',
    'We never charge a restocking fee.',
    'This policy does not limit any consumer rights or other legal rights that apply to you.',
  ]) {
    expect(text.includes(sentence), sentence).toBe(true);
  }
  // Every request starts at the existing Contact page; nothing here sends data anywhere.
  const contact = main.getByRole('link', { name: /contact/i });
  expect(await contact.count()).toBeGreaterThan(0);
  for (const href of await contact.evaluateAll((els) => els.map((el) => el.getAttribute('href')))) {
    expect(href).toBe('/contact/');
  }
  expect(await main.locator('form, input, textarea').count()).toBe(0);
});

test('who pays for shipping is stated in the right section: the customer for a voluntary exchange, the shop for a verified problem', async ({
  page,
}) => {
  await page.goto('/return-policy/');
  const sections = await page.locator('main .content').evaluate((root) => {
    const out: Record<string, string> = {};
    let current = '';
    for (const el of Array.from(root.children)) {
      if (el.tagName === 'H2') current = el.id;
      else out[current] = `${out[current] ?? ''} ${el.textContent ?? ''}`.replace(/\s+/g, ' ');
    }
    return out;
  });
  expect(sections['exchanges']).toContain('you pay the shipping costs in both directions');
  expect(sections['exchanges']).toContain('We never charge a restocking fee.');
  expect(sections['problems']).toContain('KCPrintWorks covers all necessary shipping costs');
  expect(sections['problems']).not.toContain('you pay');
  expect(sections['personalized']).toContain('cannot be exchanged if you change your mind');
  expect(sections['final-sale']).toContain('We do not accept returns for a refund');
});

test('the footer link on every kind of page opens the policy', async ({ page }) => {
  for (const start of ['/', '/shop/', '/cart/', '/contact/']) {
    await page.goto(start);
    const link = page.locator('.site-footer').getByRole('link', { name: 'Returns & Exchanges' });
    await expect(link, start).toHaveAttribute('href', '/return-policy/');
  }
  await page.goto('/');
  await page.locator('.site-footer').getByRole('link', { name: 'Returns & Exchanges' }).click();
  await expect(page).toHaveURL(/\/return-policy\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Return & Exchange Policy');
});

test('the sitemap lists the policy', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  expect(xml.includes('/return-policy/')).toBe(true);
});

test.describe('layout and accessibility', () => {
  for (const [width, height] of [
    [320, 700],
    [375, 800],
    [768, 900],
    [1280, 900],
  ] as const) {
    test(`${width}px: nothing sideways, readable line length, no axe violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/return-policy/');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      const widest = await page
        .locator('main p, main li')
        .evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().width)));
      expect(widest).toBeLessThanOrEqual(768);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(
        results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    });
  }

  test('the headings are in order and the keyboard can reach the contact buttons', async ({
    page,
  }) => {
    await page.goto('/return-policy/');
    const levels = await page
      .locator('main h1, main h2, main h3')
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]! - levels[i - 1]!, `heading ${i}`).toBeLessThanOrEqual(1);
    }
    const button = page.locator('main').getByRole('link', { name: 'Contact Us' });
    await button.focus();
    await expect(button).toBeFocused();
  });
});
