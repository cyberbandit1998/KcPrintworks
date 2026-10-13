import type { Variation } from '@kcpw/contracts/client';

export type OptionAvailability = 'ok' | 'soldout' | 'unavailable';

/**
 * Availability of one attribute option given the shopper's other selections.
 * - `unavailable`: no such variation exists (the combination cannot be bought)
 * - `soldout`: it exists but every matching variation is out of stock
 */
export function optionAvailability(
  product: { variations: readonly Pick<Variation, 'attributes' | 'stockStatus'>[] },
  attributeSlug: string,
  optionSlug: string,
  selection: Record<string, string>,
): OptionAvailability {
  // An empty value is WooCommerce's "Any": that variation fits whatever option is chosen.
  const fits = (value: string | undefined, option: string) => value === '' || value === option;
  const others = Object.entries(selection).filter(([slug]) => slug !== attributeSlug);
  const matches = product.variations.filter(
    (v) =>
      fits(v.attributes[attributeSlug], optionSlug) &&
      others.every(([slug, option]) => fits(v.attributes[slug], option)),
  );
  if (matches.length === 0) return 'unavailable';
  if (matches.every((v) => v.stockStatus === 'outofstock')) return 'soldout';
  return 'ok';
}
