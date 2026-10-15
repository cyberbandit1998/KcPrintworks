import type { OptionField, OptionSchema } from '@kcpw/contracts';

/**
 * Display hints that are independent of whichever tool filled WooCommerce with products.
 *
 * The storefront's contract with WooCommerce is its standard data (REST v3 products, variations, attributes, categories,
 * images, stock) plus the optional `_kcpw_*` meta that WE own. Everything here is a *hint about how to show* that data:
 * if a hint does not match anything (no marketplace-style attributes, no made-to-order marker), the catalog still renders
 * correctly. Nothing is written back to WooCommerce.
 */

/** Attributes that exist for other sales channels (marketplace listings), not for shoppers. Hidden from display only. */
export const MARKETPLACE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'condition',
  'condition description',
  'mpn',
  'primary color',
  'secondary color',
  'material multi',
  'occasion',
  'holiday',
]);

/**
 * The fields a shopper sees for a personalized product whose setup is NOT stored in WooCommerce (no `_kcpw_option_schema`): a name for
 * any personalized product, plus an icon and a cable color for a bag tag. The wording is what the shopper reads, so it is plain
 * instructions. WooCommerce's stored setup always wins; and the shop only accepts these choices for a product that stores the same
 * setup (docs/BAG-TAG-PERSONALIZATION.md), which `/api/catalog-status/` lists under `defaultPersonalization`.
 */
export const NAME_HELP = "Enter the name exactly as you'd like it printed.";
export const ICON_HELP = 'Enter an available icon name, such as Dog, Cat, or Flower.';
export const CABLE_COLOR_HELP = 'Enter your preferred cable color.';

export function proposedOptions(title: string): { schema: OptionSchema; proposed: boolean } {
  const personalized = /personali[sz]ed|custom name/i.test(title);
  if (!personalized) return { schema: { version: 1, fields: [] }, proposed: false };
  const fields: OptionField[] = [
    {
      id: 'name',
      type: 'text',
      label: 'Name or short text',
      helpText: NAME_HELP,
      required: true,
      minLength: 1,
      maxLength: 24,
      placeholder: 'e.g. Robin',
    },
  ];
  if (/bag tag/i.test(title)) {
    fields.push(
      {
        id: 'icon',
        type: 'text',
        label: 'Icon',
        helpText: ICON_HELP,
        required: false,
        minLength: 0,
        maxLength: 24,
        placeholder: 'e.g. Dog',
      },
      {
        id: 'cable_color',
        type: 'text',
        label: 'Cable color',
        helpText: CABLE_COLOR_HELP,
        required: false,
        minLength: 0,
        maxLength: 30,
      },
    );
  }
  return { schema: { version: 1, fields }, proposed: true };
}

/**
 * Attributes to leave out of the shopper-facing option list unless they are used to choose a variation.
 * Replace the default list with `CATALOG_HIDDEN_ATTRIBUTES` (comma-separated, case-insensitive; empty = hide none).
 */
export function readHiddenAttributes(
  env: Record<string, string | undefined> = process.env,
): ReadonlySet<string> {
  const raw = env.CATALOG_HIDDEN_ATTRIBUTES;
  if (raw === undefined) return MARKETPLACE_ATTRIBUTES;
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
}

interface MadeToOrderInput {
  attributes: { name: string; options: string[] }[];
  tags: { slug: string }[];
  meta: { key: string; value: unknown }[];
}

/**
 * "Made to order" is shown as a note on the product. It is true when ANY of these WooCommerce-side markers is present:
 * the product tag `made-to-order`, our own meta `_kcpw_made_to_order`, or a marketplace-style `Condition` attribute whose
 * value says made to order (listing tools commonly write that). None is required.
 */
export function isMadeToOrder(input: MadeToOrderInput): boolean {
  if (input.tags.some((t) => t.slug === 'made-to-order')) return true;
  const flag = input.meta.find((m) => m.key === '_kcpw_made_to_order')?.value;
  if (flag === true || flag === 1 || (typeof flag === 'string' && /^(1|yes|true)$/i.test(flag))) {
    return true;
  }
  return input.attributes.some(
    (a) =>
      a.name.toLowerCase() === 'condition' &&
      a.options.some((o) => /made[\s_-]?to[\s_-]?order/i.test(o)),
  );
}
