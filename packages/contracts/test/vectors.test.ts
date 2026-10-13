import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OptionSchemaSchema,
  optionPriceAdders,
  optionSummary,
  validateOptions,
  type OptionSchema,
  type OptionValues,
} from '../src';

/**
 * Shared test vectors for personalization (ADR-007). `kcpw-core` (PHP, Step 3) must reproduce every expected
 * result in test/vectors/options.json exactly: same ok flag, same normalized values, same issue codes, same
 * price adders, same order-item summary. The TypeScript reference here is the oracle.
 *
 * To change the behavior deliberately: edit the reference, run `UPDATE_VECTORS=1 npx vitest run test/vectors.test.ts`,
 * review the diff of options.json by eye, and update the PHP side in the same change.
 *
 * Invisible characters are written as code points (never literally) so no hidden character lands in this repo.
 */

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const ZWJ = cp(0x200d);
const BIDI_OVERRIDE = cp(0x202e);
const NUL = cp(0);

const bagTag: OptionSchema = OptionSchemaSchema.parse({
  version: 1,
  fields: [
    {
      id: 'tag_color',
      type: 'select',
      label: 'Tag color',
      required: true,
      choices: [
        { value: 'black', label: 'Black' },
        { value: 'navy', label: 'Navy' },
        { value: 'hot-pink', label: 'Hot Pink', priceEffect: { kind: 'flat', amount: 50 } },
      ],
    },
    {
      id: 'cable_color',
      type: 'radio',
      label: 'Cable color',
      required: false,
      choices: [
        { value: 'black', label: 'Black' },
        { value: 'silver', label: 'Silver', priceEffect: { kind: 'flat', amount: 100 } },
      ],
    },
    { id: 'name', type: 'text', label: 'Name', required: true, minLength: 2, maxLength: 12 },
    { id: 'icon', type: 'text', label: 'Icon', required: false, minLength: 0, maxLength: 4 },
    { id: 'note', type: 'textarea', label: 'Note', required: false, minLength: 0, maxLength: 40 },
    {
      id: 'gift',
      type: 'checkbox',
      label: 'Gift wrap',
      priceEffect: { kind: 'flat', amount: 400 },
    },
    {
      id: 'rush',
      type: 'checkbox',
      label: 'Rush',
      priceEffect: { kind: 'percent', basisPoints: 1500 },
    },
    {
      id: 'discount',
      type: 'checkbox',
      label: 'Member discount',
      priceEffect: { kind: 'percent', basisPoints: -1050 },
    },
  ],
});

const valid: OptionValues = { tag_color: 'navy', name: 'Robin' };

const cases: { name: string; base: number; input: unknown }[] = [
  { name: 'minimal valid', base: 899, input: valid },
  {
    name: 'everything filled in, with a flat select effect, a flat radio effect, and a flat checkbox effect',
    base: 899,
    input: {
      tag_color: 'hot-pink',
      cable_color: 'silver',
      name: 'Robin',
      icon: 'x',
      note: 'Hi',
      gift: true,
    },
  },
  { name: 'required select missing', base: 899, input: { name: 'Robin' } },
  { name: 'required text missing', base: 899, input: { tag_color: 'navy' } },
  { name: 'required text only whitespace', base: 899, input: { tag_color: 'navy', name: '   ' } },
  {
    name: 'select value not offered',
    base: 899,
    input: { tag_color: 'chartreuse', name: 'Robin' },
  },
  { name: 'select value is a boolean', base: 899, input: { tag_color: true, name: 'Robin' } },
  { name: 'checkbox given a string', base: 899, input: { ...valid, gift: 'yes' } },
  { name: 'text given a boolean', base: 899, input: { tag_color: 'navy', name: true } },
  { name: 'unknown field is rejected, not ignored', base: 899, input: { ...valid, price: '1' } },
  { name: 'text one character too long', base: 899, input: { ...valid, name: 'abcdefghijklm' } },
  { name: 'text exactly at the limit', base: 899, input: { ...valid, name: 'abcdefghijkl' } },
  { name: 'text below the minimum', base: 899, input: { ...valid, name: 'A' } },
  { name: 'surrounding whitespace is trimmed', base: 899, input: { ...valid, name: '  Robin  ' } },
  {
    name: 'accents are normalized to NFC and counted once',
    base: 899,
    input: { ...valid, name: `Jose${cp(0x0301)}` },
  },
  {
    name: 'four emoji are four characters, not eight',
    base: 899,
    input: { ...valid, icon: cp(0x1f600, 0x1f680, 0x1f43e, 0x2b50) },
  },
  {
    name: 'five emoji exceed a limit of four',
    base: 899,
    input: { ...valid, icon: cp(0x1f600, 0x1f680, 0x1f43e, 0x2b50, 0x1f4a1) },
  },
  {
    name: 'zero-width joiner is refused (this is why free emoji need a decision)',
    base: 899,
    input: { ...valid, icon: `a${ZWJ}b` },
  },
  {
    name: 'bidi override character is refused',
    base: 899,
    input: { ...valid, name: `Rob${BIDI_OVERRIDE}in` },
  },
  { name: 'NUL byte is refused', base: 899, input: { ...valid, name: `Ro${NUL}bin` } },
  { name: 'tab is refused', base: 899, input: { ...valid, name: 'Ro\tbin' } },
  { name: 'newline is refused in a text field', base: 899, input: { ...valid, name: 'Ro\nbin' } },
  {
    name: 'newline is allowed in a textarea, and CRLF is normalized',
    base: 899,
    input: { ...valid, note: 'one\r\ntwo' },
  },
  { name: 'optional text left empty is omitted', base: 899, input: { ...valid, icon: '' } },
  {
    name: 'unchecked checkbox adds nothing and is omitted from the summary',
    base: 899,
    input: { ...valid, gift: false },
  },
  {
    name: 'percent effect is taken of the base price and rounded half up (15% of 899 = 134.85)',
    base: 899,
    input: { ...valid, rush: true },
  },
  {
    name: 'percent effect that lands exactly on a half cent rounds away from zero (15% of 890 = 133.5)',
    base: 890,
    input: { ...valid, rush: true },
  },
  {
    name: 'negative percent effect, not on a half cent (-10.5% of 899 = -94.395), rounds to -94',
    base: 899,
    input: { ...valid, discount: true },
  },
  {
    name: 'negative percent effect exactly on a half cent rounds away from zero (-10.5% of 100 = -10.5)',
    base: 100,
    input: { ...valid, discount: true },
  },
  {
    name: 'effects add, never compound',
    base: 1000,
    input: { tag_color: 'hot-pink', cable_color: 'silver', name: 'Robin', gift: true, rush: true },
  },
  {
    name: 'input that is a string is rejected whole, not read character by character',
    base: 899,
    input: 'nope',
  },
  { name: 'input that is an array is rejected whole', base: 899, input: ['navy', 'Robin'] },
  { name: 'input that is null is rejected whole', base: 899, input: null },
];

function run(schema: OptionSchema, base: number, input: unknown) {
  const result = validateOptions(schema, input as OptionValues);
  const expected: Record<string, unknown> = {
    ok: result.ok,
    issues: result.issues.map((i) => ({ fieldId: i.fieldId, code: i.code })),
  };
  if (result.ok) {
    expected.values = result.values;
    expected.adders = optionPriceAdders(schema, result.values, {
      amount: base,
      currency: 'USD',
    }).amount;
    expected.summary = optionSummary(schema, result.values).map((s) => [s.fieldId, s.value]);
  }
  return expected;
}

/** JSON.stringify leaves some invisible characters raw; write them as escapes so the file stays reviewable. */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x007f, 0x009f],
  [0x0300, 0x036f], // combining marks: visible, but easy to miss in a diff
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const isInvisible = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return INVISIBLE_RANGES.some(([low, high]) => code >= low && code <= high);
};
const escapeInvisible = (json: string) =>
  Array.from(json, (char) =>
    isInvisible(char) ? `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}` : char,
  ).join('');

const file = resolve(__dirname, 'vectors/options.json');
const build = () => ({
  version: 1,
  note: 'Generated by test/vectors.test.ts from the TypeScript reference. kcpw-core (PHP) must reproduce every expected result.',
  schemas: { bag_tag: bagTag },
  cases: cases.map((c) => ({
    name: c.name,
    schema: 'bag_tag',
    base: { amount: c.base, currency: 'USD' },
    input: c.input,
    expected: run(bagTag, c.base, c.input),
  })),
});

describe('shared personalization vectors', () => {
  if (process.env.UPDATE_VECTORS === '1') {
    it('regenerates options.json', () => {
      writeFileSync(file, `${escapeInvisible(JSON.stringify(build(), null, 2))}\n`);
    });
    return;
  }

  it('options.json matches what the reference implementation produces today', () => {
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(build())));
  });

  it('contains no literal invisible characters', () => {
    expect(Array.from(readFileSync(file, 'utf8')).some(isInvisible)).toBe(false);
  });

  it('exercises both outcomes and every issue code the reference can produce', () => {
    const { cases: built } = build();
    expect(built.some((c) => c.expected.ok === true)).toBe(true);
    const codes = new Set(
      built.flatMap((c) => (c.expected.issues as { code: string }[]).map((i) => i.code)),
    );
    for (const code of [
      'required',
      'too_short',
      'too_long',
      'invalid_choice',
      'invalid_type',
      'invalid_characters',
      'unknown_field',
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });
});
