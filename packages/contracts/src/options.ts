import { z } from 'zod';

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
