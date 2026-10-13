import { z } from 'zod';
import { addMoney, DEFAULT_CURRENCY, percentOf, zero, type Money } from './money';

/**
 * Plugin-agnostic personalization schema (ADR-007).
 *
 * Whatever WooCommerce plugin or first-party module ends up storing the real field definitions, the
 * storefront DTO exposes this shape and the storefront UI renders from it only. `validateOptions` is the
 * reference implementation of the server-side checks; the PHP side must reproduce its results (tested
 * with shared vectors in Step 3).
 *
 * A price effect here is for DISPLAY. WooCommerce computes the authoritative charge.
 */

export const PriceEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flat'), amount: z.number().int() }),
  z.object({ kind: z.literal('percent'), basisPoints: z.number().int() }),
]);
export type PriceEffect = z.infer<typeof PriceEffectSchema>;

const fieldBase = {
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(80),
  helpText: z.string().max(300).optional(),
  required: z.boolean().default(false),
};

export const TextFieldSchema = z.object({
  ...fieldBase,
  type: z.enum(['text', 'textarea']),
  minLength: z.number().int().min(0).default(0),
  maxLength: z.number().int().min(1).max(500),
  placeholder: z.string().max(80).optional(),
  priceEffect: PriceEffectSchema.optional(),
});

export const ChoiceSchema = z.object({
  value: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  label: z.string().min(1).max(80),
  priceEffect: PriceEffectSchema.optional(),
});

export const ChoiceFieldSchema = z.object({
  ...fieldBase,
  type: z.enum(['select', 'radio']),
  choices: z.array(ChoiceSchema).min(1).max(30),
});

export const CheckboxFieldSchema = z.object({
  ...fieldBase,
  type: z.literal('checkbox'),
  priceEffect: PriceEffectSchema.optional(),
});

export const OptionFieldSchema = z.discriminatedUnion('type', [
  // `discriminatedUnion` needs literal discriminators, so text/textarea are split.
  TextFieldSchema.extend({ type: z.literal('text') }),
  TextFieldSchema.extend({ type: z.literal('textarea') }),
  ChoiceFieldSchema.extend({ type: z.literal('select') }),
  ChoiceFieldSchema.extend({ type: z.literal('radio') }),
  CheckboxFieldSchema,
]);
export type OptionField = z.infer<typeof OptionFieldSchema>;

export const OptionSchemaSchema = z.object({
  version: z.number().int().min(1),
  fields: z.array(OptionFieldSchema).max(20),
});
export type OptionSchema = z.infer<typeof OptionSchemaSchema>;

export const EMPTY_OPTION_SCHEMA: OptionSchema = { version: 1, fields: [] };

export type OptionValue = string | boolean;
export type OptionValues = Record<string, OptionValue>;

export type OptionIssueCode =
  | 'required'
  | 'too_short'
  | 'too_long'
  | 'invalid_choice'
  | 'invalid_type'
  | 'invalid_characters'
  | 'unknown_field';

export interface OptionIssue {
  fieldId: string;
  code: OptionIssueCode;
  message: string;
}

export interface OptionValidation {
  ok: boolean;
  /** Normalized values (trimmed, NFC). Only meaningful when `ok` is true. */
  values: OptionValues;
  issues: OptionIssue[];
}

/** Length counted in Unicode code points, so emoji and accents count as one character. */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

// Characters that are invisible or non-printing: ASCII controls including tab (newline is handled
// separately for textarea), C1 controls, zero-width and bidi-override characters, and the byte-order mark.
// They look harmless on screen but can corrupt print files and packing slips.
// Kept as explicit code-point ranges so no invisible character ever appears in this source file.
const FORBIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0009],
  [0x000b, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f], // zero-width space/joiners, LRM/RLM
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // byte-order mark / zero-width no-break space
];

function hasForbiddenCharacters(value: string, allowNewline: boolean): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x000a) {
      if (!allowNewline) return true;
      continue;
    }
    if (FORBIDDEN_RANGES.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

export function validateOptions(
  schema: OptionSchema,
  input: Record<string, unknown>,
): OptionValidation {
  const issues: OptionIssue[] = [];
  const values: OptionValues = {};
  const known = new Set(schema.fields.map((f) => f.id));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      issues.push({ fieldId: key, code: 'unknown_field', message: `Unknown option "${key}".` });
    }
  }

  for (const field of schema.fields) {
    const raw = input[field.id];
    const missing = raw === undefined || raw === null || raw === '';

    if (field.type === 'checkbox') {
      if (raw !== undefined && typeof raw !== 'boolean') {
        issues.push({
          fieldId: field.id,
          code: 'invalid_type',
          message: `${field.label} must be on or off.`,
        });
        continue;
      }
      if (field.required && raw !== true) {
        issues.push({
          fieldId: field.id,
          code: 'required',
          message: `${field.label} is required.`,
        });
        continue;
      }
      if (raw === true) values[field.id] = true;
      continue;
    }

    if (missing) {
      if (field.required) {
        issues.push({
          fieldId: field.id,
          code: 'required',
          message: `${field.label} is required.`,
        });
      }
      continue;
    }

    if (typeof raw !== 'string') {
      issues.push({
        fieldId: field.id,
        code: 'invalid_type',
        message: `${field.label} must be text.`,
      });
      continue;
    }

    if (field.type === 'select' || field.type === 'radio') {
      if (!field.choices.some((c) => c.value === raw)) {
        issues.push({
          fieldId: field.id,
          code: 'invalid_choice',
          message: `Choose one of the available options for ${field.label}.`,
        });
        continue;
      }
      values[field.id] = raw;
      continue;
    }

    // text / textarea
    const normalized = raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
    if (hasForbiddenCharacters(normalized, field.type === 'textarea')) {
      issues.push({
        fieldId: field.id,
        code: 'invalid_characters',
        message: `${field.label} contains characters that cannot be printed.`,
      });
      continue;
    }
    const length = characterCount(normalized);
    if (normalized === '') {
      if (field.required) {
        issues.push({
          fieldId: field.id,
          code: 'required',
          message: `${field.label} is required.`,
        });
      }
      continue;
    }
    if (length < field.minLength) {
      issues.push({
        fieldId: field.id,
        code: 'too_short',
        message: `${field.label} must be at least ${field.minLength} characters.`,
      });
      continue;
    }
    if (length > field.maxLength) {
      issues.push({
        fieldId: field.id,
        code: 'too_long',
        message: `${field.label} must be at most ${field.maxLength} characters.`,
      });
      continue;
    }
    values[field.id] = normalized;
  }

  return { ok: issues.length === 0, values, issues };
}

function effectFor(field: OptionField, value: OptionValue | undefined): PriceEffect | undefined {
  if (value === undefined) return undefined;
  if (field.type === 'select' || field.type === 'radio') {
    return field.choices.find((c) => c.value === value)?.priceEffect;
  }
  if (field.type === 'checkbox') return value === true ? field.priceEffect : undefined;
  // Text fields: the effect applies when the field is filled in.
  return value === '' ? undefined : field.priceEffect;
}

/**
 * Sum of option price effects for one unit. Percent effects are taken of the BASE unit price (variation or
 * product price before any option charges), not compounded.
 */
export function optionPriceAdders(schema: OptionSchema, values: OptionValues, base: Money): Money {
  let total = zero(base.currency || DEFAULT_CURRENCY);
  for (const field of schema.fields) {
    const effect = effectFor(field, values[field.id]);
    if (!effect) continue;
    total = addMoney(
      total,
      effect.kind === 'flat'
        ? { amount: effect.amount, currency: base.currency }
        : percentOf(base, effect.basisPoints),
    );
  }
  return total;
}

export interface OptionSummaryItem {
  fieldId: string;
  label: string;
  value: string;
}

/** Human-readable label/value pairs, in schema order. Mirrors what is stored as order-item meta. */
export function optionSummary(schema: OptionSchema, values: OptionValues): OptionSummaryItem[] {
  const out: OptionSummaryItem[] = [];
  for (const field of schema.fields) {
    const value = values[field.id];
    if (value === undefined) continue;
    if (field.type === 'checkbox') {
      if (value === true) out.push({ fieldId: field.id, label: field.label, value: 'Yes' });
    } else if (field.type === 'select' || field.type === 'radio') {
      const choice = field.choices.find((c) => c.value === value);
      if (choice) out.push({ fieldId: field.id, label: field.label, value: choice.label });
    } else if (typeof value === 'string' && value !== '') {
      out.push({ fieldId: field.id, label: field.label, value });
    }
  }
  return out;
}
