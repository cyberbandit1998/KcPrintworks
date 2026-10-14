import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEW_LIMITS, validateReviewInput } from '../src';

/**
 * Shared test vectors for review submissions. kcpw-core (PHP) must reach the same verdict on every case in test/vectors/reviews.json:
 * same ok flag, same normalized values, same (field, code) issues in the same order. The TypeScript reference is the oracle.
 * To change behavior deliberately: edit src/review-logic.ts, run `UPDATE_VECTORS=1 npx vitest run test/review-vectors.test.ts`,
 * review the diff of reviews.json by eye, and update the PHP side in the same change. Invisible characters are built from code points.
 */
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const ZWSP = cp(0x200b);
const BOM = cp(0xfeff);
const BIDI = cp(0x202e);
const NUL = cp(0);
const TAB = cp(9);
const emoji = cp(0x1f600);

const base = {
  productId: 42,
  rating: 5,
  name: 'Robin Hood',
  email: 'robin@example.com',
  review: 'A really lovely case, it fits my cards perfectly.',
};

const cases: { name: string; input: unknown }[] = [
  { name: 'minimal valid', input: base },
  {
    name: 'trims, lower-cases the email, collapses name spaces, normalizes line endings',
    input: {
      ...base,
      name: '  Robin    Hood  ',
      email: '  Robin.Hood+Test@Example.COM ',
      review: '  Great.\r\n\r\n\r\n\r\nReally great.\rSo good.  ',
    },
  },
  { name: 'name with accents and an apostrophe', input: { ...base, name: 'Zoë O’Brien-Núñez' } },
  { name: 'name in another script', input: { ...base, name: '田中 太郎' } },
  { name: 'name with a number and a dot', input: { ...base, name: 'J. R. R. Tolkien 3rd' } },
  { name: 'name exactly 2 characters', input: { ...base, name: 'Jo' } },
  { name: 'name one character', input: { ...base, name: 'J' } },
  { name: 'name 60 characters', input: { ...base, name: 'a'.repeat(60) } },
  { name: 'name 61 characters', input: { ...base, name: 'a'.repeat(61) } },
  { name: 'name with an at sign', input: { ...base, name: 'bob@example.com' } },
  { name: 'name with a slash (link-like)', input: { ...base, name: 'Visit/this' } },
  { name: 'name with only digits', input: { ...base, name: '12345' } },
  { name: 'name with a zero-width space', input: { ...base, name: `Rob${ZWSP}in` } },
  { name: 'name with a newline', input: { ...base, name: 'Rob\nin' } },
  { name: 'name missing', input: { ...base, name: undefined } },
  { name: 'name only spaces', input: { ...base, name: '   ' } },
  { name: 'name not a string', input: { ...base, name: 5 } },
  { name: 'email without a domain dot', input: { ...base, email: 'robin@localhost' } },
  { name: 'email with two dots', input: { ...base, email: 'ro..bin@example.com' } },
  { name: 'email with a space inside', input: { ...base, email: 'ro bin@example.com' } },
  { name: 'email with a non-ASCII letter', input: { ...base, email: 'robïn@example.com' } },
  {
    name: 'email with a one-letter top-level domain',
    input: { ...base, email: 'robin@example.c' },
  },
  { name: 'email too long', input: { ...base, email: `${'a'.repeat(110)}@example.com` } },
  { name: 'email missing', input: { ...base, email: '' } },
  { name: 'email not a string', input: { ...base, email: ['a@b.com'] } },
  { name: 'review exactly 10 characters', input: { ...base, review: 'abcdefghij' } },
  { name: 'review 9 characters', input: { ...base, review: 'abcdefghi' } },
  { name: 'review exactly 2000 characters', input: { ...base, review: 'a'.repeat(2000) } },
  { name: 'review 2001 characters', input: { ...base, review: 'a'.repeat(2001) } },
  {
    name: 'review counts emoji as one character each',
    input: { ...base, review: emoji.repeat(10) },
  },
  {
    name: 'review with a line break',
    input: { ...base, review: 'First line is here.\nSecond line is here.' },
  },
  {
    name: 'review with an http link',
    input: { ...base, review: 'See http://spam.example for deals' },
  },
  {
    name: 'review with an https link',
    input: { ...base, review: 'See https://spam.example for deals' },
  },
  { name: 'review with www', input: { ...base, review: 'Visit www.spam-site for deals' } },
  {
    name: 'review with a bare domain',
    input: { ...base, review: 'Cheaper at etsy.com right now' },
  },
  {
    name: 'review with an email address in it',
    input: { ...base, review: 'Write me at someone@mail.net please' },
  },
  {
    name: 'review mentioning a file name is fine',
    input: { ...base, review: 'The print came out as a PNG-like picture.' },
  },
  { name: 'review with a tab', input: { ...base, review: `Tab${TAB}separated review text` } },
  {
    name: 'review with a zero-width space',
    input: { ...base, review: `Lovely${ZWSP} case, thank you` },
  },
  {
    name: 'review with a byte-order mark inside',
    input: { ...base, review: `Lovely ${BOM}case, thank you` },
  },
  {
    name: 'review with a bidi override',
    input: { ...base, review: `Lovely ${BIDI}case, thank you` },
  },
  { name: 'review with a NUL', input: { ...base, review: `Lovely ${NUL}case, thank you` } },
  {
    name: 'review with angle brackets is kept as text',
    input: { ...base, review: 'I <3 this little case a lot' },
  },
  { name: 'review missing', input: { ...base, review: null } },
  { name: 'review not a string', input: { ...base, review: 12345678901 } },
  { name: 'rating 1', input: { ...base, rating: 1 } },
  { name: 'rating 0', input: { ...base, rating: 0 } },
  { name: 'rating 6', input: { ...base, rating: 6 } },
  { name: 'rating 4.5', input: { ...base, rating: 4.5 } },
  { name: 'rating as text', input: { ...base, rating: '5' } },
  { name: 'rating missing', input: { ...base, rating: undefined } },
  { name: 'productId as text', input: { ...base, productId: '42' } },
  { name: 'productId zero', input: { ...base, productId: 0 } },
  { name: 'productId negative', input: { ...base, productId: -3 } },
  { name: 'productId fractional', input: { ...base, productId: 1.5 } },
  { name: 'productId beyond 32 bits', input: { ...base, productId: 2147483648 } },
  { name: 'productId missing', input: { ...base, productId: undefined } },
  { name: 'a verified flag is refused', input: { ...base, verified: true } },
  {
    name: 'an approved flag and a status are refused',
    input: { ...base, approved: 1, status: 'approve' },
  },
  {
    name: 'several problems are all reported, in field order',
    input: { productId: 0, rating: 9, name: '', email: 'x', review: 'short' },
  },
  { name: 'null input', input: null },
  { name: 'array input', input: [base] },
  { name: 'string input', input: 'review' },
];

function expectedFor(input: unknown) {
  const result = validateReviewInput(input);
  return result.ok
    ? { ok: true as const, value: result.value, issues: [] as { field: string; code: string }[] }
    : {
        ok: false as const,
        value: null,
        issues: result.issues.map((i) => ({ field: i.field, code: i.code })),
      };
}

const file = resolve(__dirname, 'vectors/reviews.json');
const generated = {
  version: 1,
  note: 'Generated by test/review-vectors.test.ts from the TypeScript reference (validateReviewInput). kcpw-core (PHP) must reproduce every expected result.',
  limits: REVIEW_LIMITS,
  cases: cases.map((c) => ({ name: c.name, input: c.input, expected: expectedFor(c.input) })),
};

describe('shared review vectors', () => {
  it('reviews.json matches what the reference produces (run with UPDATE_VECTORS=1 to regenerate)', () => {
    if (process.env.UPDATE_VECTORS) {
      writeFileSync(file, JSON.stringify(generated, null, 2) + '\n');
    }
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(generated)));
  });

  it('covers every issue code', () => {
    const codes = new Set(generated.cases.flatMap((c) => c.expected.issues.map((i) => i.code)));
    for (const code of [
      'invalid_type',
      'unknown_field',
      'required',
      'too_short',
      'too_long',
      'invalid_characters',
      'invalid_email',
      'invalid_rating',
      'invalid_product',
      'links_not_allowed',
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('normalizes as documented', () => {
    const second = expectedFor(cases[1]!.input);
    expect(second.ok).toBe(true);
    expect(second.value).toMatchObject({
      name: 'Robin Hood',
      email: 'robin.hood+test@example.com',
      review: 'Great.\n\nReally great.\nSo good.',
    });
  });
});
