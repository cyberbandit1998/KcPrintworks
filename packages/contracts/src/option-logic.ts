import { addMoney, DEFAULT_CURRENCY, percentOf, zero, type Money } from './money';
import type {
  OptionField,
  OptionIssue,
  OptionSchema,
  OptionValidation,
  OptionValue,
  OptionValues,
  PriceEffect,
} from './options';

/**
 * Reference personalization logic (ADR-007): validation, price effects, and summaries.
 * Zod-free on purpose so the browser can run it without the validation library; the schemas live in options.ts.
 */

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

  // Callers hold untrusted JSON. Anything but a plain object (a string, array, or null) is rejected as a
  // whole instead of being read key by key (a string's "keys" are its character positions).
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      values: {},
      issues: [
        {
          fieldId: '',
          code: 'invalid_type',
          message: 'Personalization must be a set of named fields.',
        },
      ],
    };
  }

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
