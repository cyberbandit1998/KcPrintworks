import { addMoney, multiplyMoney, zero, type Money } from './money';
import { lineKey } from './cart-logic';
import type { CartLineIntent, QuoteIssue, QuoteLine } from './cart';
import { optionPriceAdders, optionSummary, validateOptions } from './option-logic';
import type { Product, ProductAttribute, Variation } from './product';

/**
 * Reference implementation of what the server does with one cart line:
 * resolve the variation, check availability and quantity, validate personalization, price it.
 *
 * It is used (a) by the storefront's quote route while data comes from fixtures, and (b) as the oracle for
 * shared test vectors that the WooCommerce side (`kcpw-core`) must reproduce in Step 3. In production the
 * authoritative numbers come from WooCommerce, never from this module.
 */

/** WooCommerce stores "Any" as an empty attribute value. */
const ANY = '';

const variationAttributes = (product: { attributes: readonly ProductAttribute[] }) =>
  product.attributes.filter((a) => a.usedForVariations);

/**
 * The variation WooCommerce would use for a complete selection: every variation attribute must match
 * exactly or be "Any". A variation with fewer "Any" attributes (more specific) wins; ties keep list order.
 * (Mirrors WooCommerce's behavior; confirmed against its PHP implementation with shared vectors in Step 2.)
 */
export function findVariation<V extends Pick<Variation, 'id' | 'attributes'>>(
  product: { attributes: readonly ProductAttribute[]; variations: readonly V[] },
  selection: Record<string, string>,
): V | undefined {
  const varAttrs = variationAttributes(product);
  if (varAttrs.length === 0) return undefined;
  if (varAttrs.some((a) => !selection[a.slug])) return undefined;
  let best: V | undefined;
  let bestSpecificity = -1;
  for (const v of product.variations) {
    const matches = varAttrs.every((a) => {
      const value = v.attributes[a.slug];
      return value === ANY || value === selection[a.slug];
    });
    if (!matches) continue;
    const specificity = varAttrs.filter((a) => v.attributes[a.slug] !== ANY).length;
    if (specificity > bestSpecificity) {
      best = v;
      bestSpecificity = specificity;
    }
  }
  return best;
}

/** "Size: Small, Color: Red" from the shopper's selection, using option display names. */
export function selectionLabel(
  product: { attributes: readonly ProductAttribute[] },
  selection: Record<string, string>,
): string {
  return variationAttributes(product)
    .filter((a) => selection[a.slug])
    .map((a) => {
      const option = a.options.find((o) => o.slug === selection[a.slug]);
      return `${a.name}: ${option?.name ?? selection[a.slug]}`;
    })
    .join(', ');
}

export function priceRange(product: Product): { min: Money; max: Money } {
  if (product.type === 'simple' || product.variations.length === 0) {
    return { min: product.price, max: product.price };
  }
  const amounts = product.variations.map((v) => v.price.amount);
  const currency = product.price.currency;
  return {
    min: { amount: Math.min(...amounts), currency },
    max: { amount: Math.max(...amounts), currency },
  };
}

export function priceLine(product: Product | undefined, intent: CartLineIntent): QuoteLine {
  const key = lineKey(intent);
  const issues: QuoteIssue[] = [];

  if (!product) {
    return {
      key,
      productId: intent.productId,
      variationId: intent.variationId,
      name: 'Unavailable item',
      quantity: intent.quantity,
      unitPrice: zero(),
      optionAdders: zero(),
      lineTotal: zero(),
      optionSummary: [],
      issues: [{ code: 'unknown_product', message: 'This item is no longer available.' }],
    };
  }

  const currency = product.price.currency;
  let base: Money = product.price;
  let variation: Variation | undefined;
  let stockStatus = product.availability.stockStatus;
  let stockQuantity = product.availability.stockQuantity;

  if (!product.availability.purchasable) {
    issues.push({ code: 'unavailable', message: `${product.name} is not available to purchase.` });
  }

  let selection: Record<string, string> = {};
  if (product.type === 'variable') {
    const varAttrs = variationAttributes(product);
    variation = product.variations.find((v) => v.id === intent.variationId);
    if (!variation) {
      issues.push({ code: 'invalid_variation', message: 'Choose a valid option for this item.' });
    } else {
      base = variation.price;
      stockStatus = variation.stockStatus;
      stockQuantity = variation.stockQuantity;

      // A fixed variation supplies its own value; an "Any" attribute must be chosen explicitly.
      selection = { ...intent.attributes };
      for (const attr of varAttrs) {
        const fixed = variation.attributes[attr.slug] ?? ANY;
        const chosen = selection[attr.slug];
        if (fixed !== ANY) {
          if (chosen !== undefined && chosen !== fixed) {
            issues.push({
              code: 'invalid_variation',
              message: `The chosen ${attr.name.toLowerCase()} does not match this variation.`,
            });
          }
          selection[attr.slug] = fixed;
        } else if (!chosen) {
          issues.push({
            code: 'invalid_variation',
            message: `Choose a ${attr.name.toLowerCase()}.`,
          });
        } else if (!attr.options.some((o) => o.slug === chosen)) {
          issues.push({
            code: 'invalid_variation',
            message: `That ${attr.name.toLowerCase()} is not available.`,
          });
        }
      }
      for (const slug of Object.keys(selection)) {
        if (!varAttrs.some((a) => a.slug === slug)) {
          issues.push({ code: 'invalid_variation', message: 'Unknown variation option.' });
        }
      }
    }
  } else if (intent.variationId !== undefined || Object.keys(intent.attributes ?? {}).length > 0) {
    issues.push({ code: 'invalid_variation', message: 'This item has no variations.' });
  }

  const unlimited = product.availability.madeToOrder || stockStatus === 'onbackorder';
  if (stockStatus === 'outofstock') {
    issues.push({ code: 'out_of_stock', message: `${product.name} is out of stock.` });
  } else if (!unlimited && stockQuantity !== undefined && intent.quantity > stockQuantity) {
    issues.push({
      code: 'quantity_limit',
      message: `Only ${stockQuantity} available for ${product.name}.`,
    });
  }

  const validation = validateOptions(product.optionSchema, intent.options);
  for (const issue of validation.issues) {
    issues.push({ code: 'invalid_option', field: issue.fieldId, message: issue.message });
  }

  const adders = validation.ok
    ? optionPriceAdders(product.optionSchema, validation.values, base)
    : zero(currency);
  const unitPrice = addMoney(base, adders);

  return {
    key,
    productId: product.id,
    variationId: variation?.id,
    slug: product.slug,
    name: product.name,
    variationLabel: variation ? selectionLabel(product, selection) || undefined : undefined,
    image: variation?.image ?? product.images[0],
    quantity: intent.quantity,
    unitPrice,
    optionAdders: adders,
    lineTotal: multiplyMoney(unitPrice, intent.quantity),
    optionSummary: validation.ok ? optionSummary(product.optionSchema, validation.values) : [],
    issues,
  };
}
