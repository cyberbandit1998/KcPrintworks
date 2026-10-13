import { describe, expect, it } from 'vitest';
import {
  characterCount,
  money,
  optionPriceAdders,
  optionSummary,
  OptionSchemaSchema,
  validateOptions,
  type OptionSchema,
} from '../src';

const schema: OptionSchema = OptionSchemaSchema.parse({
  version: 1,
  fields: [
    { id: 'name', type: 'text', label: 'Name', required: true, maxLength: 10, minLength: 2 },
    { id: 'note', type: 'textarea', label: 'Note', maxLength: 40 },
    {
      id: 'frame',
      type: 'select',
      label: 'Frame',
      choices: [
        { value: 'black', label: 'Black' },
        { value: 'natural', label: 'Natural', priceEffect: { kind: 'flat', amount: 600 } },
        { value: 'gold', label: 'Gold', priceEffect: { kind: 'percent', basisPoints: 1500 } },
      ],
    },
    {
      id: 'gift',
      type: 'checkbox',
      label: 'Gift wrap',
      priceEffect: { kind: 'flat', amount: 400 },
    },
  ],
});

describe('validateOptions', () => {
  it('accepts valid input and normalizes text', () => {
    const r = validateOptions(schema, { name: '  Ada  ', frame: 'black', gift: true });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ name: 'Ada', frame: 'black', gift: true });
  });

  it('requires required fields', () => {
    const r = validateOptions(schema, {});
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => [i.fieldId, i.code])).toEqual([['name', 'required']]);
  });

  it('enforces min and max length by code points, not UTF-16 units', () => {
    expect(validateOptions(schema, { name: 'A' }).issues[0]?.code).toBe('too_short');
    expect(validateOptions(schema, { name: 'A'.repeat(11) }).issues[0]?.code).toBe('too_long');
    // 10 emoji are 20 UTF-16 units but 10 characters: allowed.
    expect(validateOptions(schema, { name: '😀'.repeat(10) }).ok).toBe(true);
    expect(characterCount('😀😀')).toBe(2);
  });

  it('rejects unknown fields (tamper attempt) instead of ignoring them', () => {
    const r = validateOptions(schema, { name: 'Ada', price: '0' });
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual(
      expect.objectContaining({ fieldId: 'price', code: 'unknown_field' }),
    );
  });

  it('rejects choices that are not in the schema', () => {
    const r = validateOptions(schema, { name: 'Ada', frame: 'platinum' });
    expect(r.issues[0]).toMatchObject({ fieldId: 'frame', code: 'invalid_choice' });
  });

  it('rejects wrong types', () => {
    expect(validateOptions(schema, { name: 'Ada', gift: 'yes' }).issues[0]?.code).toBe(
      'invalid_type',
    );
    expect(validateOptions(schema, { name: 42 }).issues[0]?.code).toBe('invalid_type');
    expect(validateOptions(schema, { name: false }).issues[0]?.code).toBe('invalid_type');
  });

  it('rejects control, zero-width, and bidi-override characters', () => {
    const bad_inputs = [0x0000, 0x200b, 0x202e, 0x0009, 0xfeff].map(
      (code) => `Ad${String.fromCodePoint(code)}a`,
    );
    for (const bad of bad_inputs) {
      expect(validateOptions(schema, { name: bad }).issues[0]?.code).toBe('invalid_characters');
    }
  });

  it('allows newlines in textarea but not in single-line text', () => {
    expect(validateOptions(schema, { name: 'Ada', note: 'line1\nline2' }).ok).toBe(true);
    expect(validateOptions(schema, { name: 'Ad\na' }).issues[0]?.code).toBe('invalid_characters');
  });

  it('treats an empty optional field as absent', () => {
    const r = validateOptions(schema, { name: 'Ada', note: '   ', frame: '' });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ name: 'Ada' });
  });
});

describe('optionPriceAdders', () => {
  const base = money(2400);

  it('adds flat and percent effects without compounding', () => {
    const adders = optionPriceAdders(schema, { name: 'Ada', frame: 'gold', gift: true }, base);
    // 15% of $24.00 = $3.60, plus $4.00 gift wrap
    expect(adders.amount).toBe(360 + 400);
  });

  it('is zero when nothing priced is chosen', () => {
    expect(optionPriceAdders(schema, { name: 'Ada', frame: 'black' }, base).amount).toBe(0);
  });

  it('ignores an unchecked checkbox', () => {
    expect(optionPriceAdders(schema, { name: 'Ada', gift: false }, base).amount).toBe(0);
  });
});

describe('optionSummary', () => {
  it('returns labels and human-readable values in schema order', () => {
    const summary = optionSummary(schema, { gift: true, name: 'Ada', frame: 'natural' });
    expect(summary).toEqual([
      { fieldId: 'name', label: 'Name', value: 'Ada' },
      { fieldId: 'frame', label: 'Frame', value: 'Natural' },
      { fieldId: 'gift', label: 'Gift wrap', value: 'Yes' },
    ]);
  });
});
