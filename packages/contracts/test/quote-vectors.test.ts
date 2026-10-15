import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deadlineProblem,
  isCalendarDate,
  PROJECT_TYPES,
  QUOTE_LIMITS,
  validateQuoteApproval,
  validateQuoteRequest,
} from '../src';

/**
 * Shared test vectors for custom quote requests and approvals. The kcpw-quotes plugin (PHP) must reach the same verdict on every case in
 * test/vectors/quotes.json: same ok flag, same normalized values, same (field, code) issues in the same order. The TypeScript reference
 * is the oracle. To change behavior deliberately: edit src/quote-logic.ts, run `UPDATE_VECTORS=1 npx vitest run test/quote-vectors.test.ts`,
 * review the diff of quotes.json by eye, and update the PHP side in the same change. Invisible characters are built from code points.
 */
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const ZWSP = cp(0x200b);
const BIDI = cp(0x202e);
const NUL = cp(0);
const TAB = cp(9);

const base = {
  name: 'Robin Hood',
  email: 'robin@example.com',
  projectType: 'game-case',
  game: 'Catan',
  description: 'A case for the base game and both expansions, with room for the sleeves.',
  dimensions: '12 x 12 x 4 in',
  quantity: 2,
  colors: 'Forest green and black',
  deadline: '2026-12-20',
  shipTo: 'US 48503',
};

const request: { name: string; input: unknown }[] = [
  { name: 'complete and valid', input: base },
  {
    name: 'only the required fields',
    input: {
      name: 'Robin Hood',
      email: 'robin@example.com',
      projectType: 'other',
      description: 'Something small to hold my dice, about the size of a fist.',
      quantity: 1,
    },
  },
  {
    name: 'trims, lower-cases the email, collapses spaces, normalizes line endings',
    input: {
      ...base,
      name: '  Robin    Hood  ',
      email: '  Robin.Hood+Test@Example.COM ',
      game: '  Settlers   of Catan ',
      description: '  Line one is here.\r\n\r\n\r\n\r\nLine two is here.\rLine three is here.  ',
      colors: ' red,   blue ',
    },
  },
  { name: 'name with accents and an apostrophe', input: { ...base, name: 'Zoë O’Brien-Núñez' } },
  { name: 'name in another script', input: { ...base, name: '田中 太郎' } },
  { name: 'name one character', input: { ...base, name: 'J' } },
  { name: 'name 80 characters', input: { ...base, name: 'a'.repeat(80) } },
  { name: 'name 81 characters', input: { ...base, name: 'a'.repeat(81) } },
  { name: 'name with an at sign', input: { ...base, name: 'bob@example.com' } },
  { name: 'name with a zero-width space', input: { ...base, name: `Rob${ZWSP}in` } },
  { name: 'name missing', input: { ...base, name: undefined } },
  { name: 'name only spaces', input: { ...base, name: '   ' } },
  { name: 'name not a string', input: { ...base, name: 5 } },
  { name: 'email without a domain dot', input: { ...base, email: 'robin@localhost' } },
  { name: 'email with two dots', input: { ...base, email: 'ro..bin@example.com' } },
  { name: 'email with a non-ASCII letter', input: { ...base, email: 'robïn@example.com' } },
  { name: 'email too long', input: { ...base, email: `${'a'.repeat(110)}@example.com` } },
  { name: 'email missing', input: { ...base, email: '' } },
  { name: 'email not a string', input: { ...base, email: ['a@b.com'] } },
  ...PROJECT_TYPES.map((t) => ({
    name: `project type ${t.value}`,
    input: { ...base, projectType: t.value },
  })),
  { name: 'project type unknown', input: { ...base, projectType: 'rocket' } },
  { name: 'project type missing', input: { ...base, projectType: undefined } },
  { name: 'project type not a string', input: { ...base, projectType: 3 } },
  { name: 'description exactly 20 characters', input: { ...base, description: 'a'.repeat(20) } },
  { name: 'description 19 characters', input: { ...base, description: 'a'.repeat(19) } },
  {
    name: 'description exactly 4000 characters',
    input: { ...base, description: 'a'.repeat(4000) },
  },
  { name: 'description 4001 characters', input: { ...base, description: 'a'.repeat(4001) } },
  {
    name: 'description with line breaks',
    input: { ...base, description: 'First line is here.\nSecond line is here.' },
  },
  {
    name: 'description with two links is fine',
    input: {
      ...base,
      description: 'Model is at https://models.example/a and https://models.example/b please.',
    },
  },
  {
    name: 'description with three links',
    input: {
      ...base,
      description: 'See https://a.example/x and www.b.example and c-shop.com for models',
    },
  },
  {
    name: 'description with a tab',
    input: { ...base, description: `Tab${TAB}separated description text` },
  },
  {
    name: 'description with a bidi override',
    input: { ...base, description: `Make it ${BIDI}nicely please, thank you` },
  },
  {
    name: 'description with a NUL',
    input: { ...base, description: `Make it ${NUL}nicely please, thank you` },
  },
  {
    name: 'description with angle brackets is kept as text',
    input: { ...base, description: 'I <3 this idea, make a small box for it' },
  },
  { name: 'description missing', input: { ...base, description: null } },
  { name: 'description not a string', input: { ...base, description: 12345678901 } },
  { name: 'game with a link', input: { ...base, game: 'see https://spam.example' } },
  { name: 'game too long', input: { ...base, game: 'g'.repeat(121) } },
  { name: 'game with a newline', input: { ...base, game: 'Cat\nan' } },
  { name: 'game empty is fine', input: { ...base, game: '' } },
  { name: 'game not a string', input: { ...base, game: 7 } },
  { name: 'dimensions too long', input: { ...base, dimensions: 'd'.repeat(201) } },
  { name: 'dimensions with a bare domain', input: { ...base, dimensions: 'see shop.com' } },
  { name: 'colors too long', input: { ...base, colors: 'c'.repeat(201) } },
  { name: 'shipTo too long', input: { ...base, shipTo: 's'.repeat(121) } },
  { name: 'quantity 1', input: { ...base, quantity: 1 } },
  { name: 'quantity 1000', input: { ...base, quantity: 1000 } },
  { name: 'quantity 1001', input: { ...base, quantity: 1001 } },
  { name: 'quantity 0', input: { ...base, quantity: 0 } },
  { name: 'quantity negative', input: { ...base, quantity: -2 } },
  { name: 'quantity fractional', input: { ...base, quantity: 1.5 } },
  { name: 'quantity as text', input: { ...base, quantity: '2' } },
  { name: 'quantity missing', input: { ...base, quantity: undefined } },
  { name: 'deadline a real date', input: { ...base, deadline: '2027-02-28' } },
  { name: 'deadline on a leap day', input: { ...base, deadline: '2028-02-29' } },
  { name: 'deadline not a leap day', input: { ...base, deadline: '2027-02-29' } },
  { name: 'deadline that does not exist', input: { ...base, deadline: '2026-02-30' } },
  { name: 'deadline month 13', input: { ...base, deadline: '2026-13-01' } },
  { name: 'deadline written the American way', input: { ...base, deadline: '12/20/2026' } },
  { name: 'deadline with a time', input: { ...base, deadline: '2026-12-20T10:00:00Z' } },
  { name: 'deadline empty is fine', input: { ...base, deadline: '' } },
  { name: 'deadline a number', input: { ...base, deadline: 20261220 } },
  { name: 'a price is refused', input: { ...base, price: 100 } },
  {
    name: 'a status and an order are refused',
    input: { ...base, status: 'approved', orderId: 12 },
  },
  {
    name: 'several problems are all reported, in field order',
    input: { name: '', email: 'x', projectType: 'x', description: 'short', quantity: 0 },
  },
  { name: 'null input', input: null },
  { name: 'array input', input: [base] },
  { name: 'string input', input: 'quote' },
];

const addr = {
  revision: 1,
  line1: '12 Main Street',
  line2: 'Apt 4',
  city: 'Flint',
  state: 'MI',
  postcode: '48503',
  country: 'US',
  phone: '+1 (810) 555-0100',
  accepted: true,
};

const approval: { name: string; input: unknown }[] = [
  { name: 'complete and valid', input: addr },
  {
    name: 'only the required fields',
    input: {
      revision: 0,
      line1: '12 Main Street',
      city: 'Flint',
      postcode: '48503',
      country: 'us',
      accepted: true,
    },
  },
  {
    name: 'trims and collapses spaces, upper-cases the country',
    input: { ...addr, line1: '  12   Main   Street ', city: ' Flint  ', country: ' ca ' },
  },
  { name: 'a UK postcode', input: { ...addr, country: 'GB', postcode: 'SW1A 2AA', state: '' } },
  { name: 'a Canadian postcode', input: { ...addr, country: 'CA', postcode: 'M5H 1A1' } },
  { name: 'postcode too short', input: { ...addr, postcode: '1' } },
  { name: 'postcode with a symbol', input: { ...addr, postcode: '48503;' } },
  { name: 'postcode too long', input: { ...addr, postcode: '1234567890123' } },
  { name: 'street too short', input: { ...addr, line1: '12' } },
  { name: 'street too long', input: { ...addr, line1: 'x'.repeat(101) } },
  { name: 'street with a zero-width space', input: { ...addr, line1: `12 Main${ZWSP} Street` } },
  { name: 'street with a newline', input: { ...addr, line1: '12 Main\nStreet' } },
  { name: 'street missing', input: { ...addr, line1: '' } },
  { name: 'city missing', input: { ...addr, city: undefined } },
  { name: 'city one character', input: { ...addr, city: 'F' } },
  { name: 'state too long', input: { ...addr, state: 's'.repeat(61) } },
  { name: 'country not two letters', input: { ...addr, country: 'USA' } },
  { name: 'country a number', input: { ...addr, country: 12 } },
  { name: 'country missing', input: { ...addr, country: '' } },
  { name: 'phone with letters', input: { ...addr, phone: 'call me' } },
  { name: 'phone too short', input: { ...addr, phone: '123' } },
  { name: 'phone empty is fine', input: { ...addr, phone: '' } },
  { name: 'not accepted', input: { ...addr, accepted: false } },
  { name: 'accepted as text', input: { ...addr, accepted: 'true' } },
  { name: 'accepted missing', input: { ...addr, accepted: undefined } },
  { name: 'revision as text', input: { ...addr, revision: '1' } },
  { name: 'revision negative', input: { ...addr, revision: -1 } },
  { name: 'revision fractional', input: { ...addr, revision: 1.5 } },
  { name: 'revision missing', input: { ...addr, revision: undefined } },
  { name: 'a price is refused', input: { ...addr, total: 1 } },
  { name: 'a quote reference is refused', input: { ...addr, ref: 'KCQ-ABC' } },
  {
    name: 'several problems are all reported, in field order',
    input: { revision: 'x', line1: '', city: '', postcode: '', country: '', accepted: false },
  },
  { name: 'null input', input: null },
  { name: 'array input', input: [addr] },
];

const dates = [
  '2026-12-24',
  '2026-02-28',
  '2026-02-29',
  '2028-02-29',
  '2100-02-29',
  '2000-02-29',
  '2026-04-31',
  '2026-00-10',
  '2026-10-00',
  '26-10-10',
  '2026-1-1',
  '',
  '2026-10-10 ',
  '1899-12-31',
  '2201-01-01',
];

const deadlines: { deadline: string; today: string }[] = [
  { deadline: '', today: '2026-10-15' },
  { deadline: '2026-10-14', today: '2026-10-15' },
  { deadline: '2026-10-15', today: '2026-10-15' },
  { deadline: '2026-10-16', today: '2026-10-15' },
  { deadline: '2028-10-15', today: '2026-10-15' },
  { deadline: '2028-10-16', today: '2026-10-15' },
  { deadline: '2028-02-29', today: '2026-02-28' },
];

const shape = (
  r: ReturnType<typeof validateQuoteRequest> | ReturnType<typeof validateQuoteApproval>,
) =>
  r.ok
    ? { ok: true as const, value: r.value, issues: [] as { field: string; code: string }[] }
    : {
        ok: false as const,
        value: null,
        issues: r.issues.map((i) => ({ field: i.field, code: i.code })),
      };

const file = resolve(__dirname, 'vectors/quotes.json');
const generated = {
  version: 1,
  note: 'Generated by test/quote-vectors.test.ts from the TypeScript reference (validateQuoteRequest, validateQuoteApproval, isCalendarDate, deadlineProblem). kcpw-quotes (PHP) must reproduce every expected result.',
  limits: QUOTE_LIMITS,
  projectTypes: PROJECT_TYPES.map((t) => t.value),
  request: request.map((c) => ({
    name: c.name,
    input: c.input,
    expected: shape(validateQuoteRequest(c.input)),
  })),
  approval: approval.map((c) => ({
    name: c.name,
    input: c.input,
    expected: shape(validateQuoteApproval(c.input)),
  })),
  dates: dates.map((d) => ({ date: d, valid: isCalendarDate(d) })),
  deadlines: deadlines.map((d) => ({ ...d, problem: deadlineProblem(d.deadline, d.today) })),
};

describe('shared quote vectors', () => {
  it('quotes.json matches what the reference produces (run with UPDATE_VECTORS=1 to regenerate)', () => {
    if (process.env.UPDATE_VECTORS) writeFileSync(file, JSON.stringify(generated, null, 2) + '\n');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(generated)));
  });

  it('covers every issue code the validators can give', () => {
    const codes = new Set(
      [...generated.request, ...generated.approval].flatMap((c) =>
        c.expected.issues.map((i) => i.code),
      ),
    );
    for (const code of [
      'invalid_type',
      'unknown_field',
      'required',
      'too_short',
      'too_long',
      'invalid_characters',
      'invalid_email',
      'invalid_choice',
      'invalid_quantity',
      'invalid_date',
      'links_not_allowed',
      'too_many_links',
      'terms_required',
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('normalizes as documented', () => {
    const third = generated.request[2]!.expected;
    expect(third.ok).toBe(true);
    expect(third.value).toMatchObject({
      name: 'Robin Hood',
      email: 'robin.hood+test@example.com',
      game: 'Settlers of Catan',
      colors: 'red, blue',
      description: 'Line one is here.\n\nLine two is here.\nLine three is here.',
    });
  });

  it('refuses a price, a status and an order number, however they are named', () => {
    for (const extra of [
      { price: 1 },
      { status: 'paid' },
      { orderId: 1 },
      { total: 5 },
      { id: 1 },
    ]) {
      expect(validateQuoteRequest({ ...base, ...extra }).ok).toBe(false);
      expect(validateQuoteApproval({ ...addr, ...extra }).ok).toBe(false);
    }
  });

  it('a deadline in the past or beyond two years is flagged, today is fine', () => {
    expect(deadlineProblem('2026-10-14', '2026-10-15')).toBe('past');
    expect(deadlineProblem('2026-10-15', '2026-10-15')).toBeNull();
    expect(deadlineProblem('2028-10-16', '2026-10-15')).toBe('too_far');
    expect(deadlineProblem('', '2026-10-15')).toBeNull();
  });
});
