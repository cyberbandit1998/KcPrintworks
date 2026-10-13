import { addMoney, multiplyMoney, zero, type Money } from './money';
import { lineKey, type CartLineIntent, type QuoteIssue, type QuoteLine } from './cart';
import { optionPriceAdders, optionSummary, validateOptions } from './options';
import type { Product, Variation } from './product';

/**
 * Reference implementation of what the server does with one cart line:
 * resolve the variation, check availability and quantity, validate personalization, price it.
 *
 * It is used (a) by the storefront's quote route while data comes from fixtures, and (b) as the oracle for
 * shared test vectors that the WooCommerce side (`kcpw-core`) must reproduce in Step 3. In production the
 * authoritative numbers come from WooCommerce, never from this module.
 */

export function findVariation(
  product: Product,
  selection: Record<string, string>,
): Variation | undefined {
  const varAttrs = product.attributes.filter((a) => a.usedForVariations);
  if (varAttrs.length === 0) return undefined;
  if (varAttrs.some((a) => !selection[a.slug])) return undefined;
  return product.variations.find((v) =>
    varAttrs.every((a) => v.attributes[a.slug] === selection[a.slug]),
  );
}

export function variationLabel(product: Product, variation: Variation): string {
  return product.attributes
    .filter((a) => a.usedForVariations)
    .map((a) => {
      const option = a.options.find((o) => o.slug === variation.attributes[a.slug]);
      return `${a.name}: ${option?.name ?? variation.attributes[a.slug]}`;
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

  if (product.type === 'variable') {
    variation = product.variations.find((v) => v.id === intent.variationId);
    if (!variation) {
      issues.push({ code: 'invalid_variation', message: 'Choose a valid option for this item.' });
    } else {
      base = variation.price;
      stockStatus = variation.stockStatus;
      stockQuantity = variation.stockQuantity;
    }
  } else if (intent.variationId !== undefined) {
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
    variationLabel: variation ? variationLabel(product, variation) : undefined,
    image: variation?.image ?? product.images[0],
    quantity: intent.quantity,
    unitPrice,
    optionAdders: adders,
    lineTotal: multiplyMoney(unitPrice, intent.quantity),
    optionSummary: validation.ok ? optionSummary(product.optionSchema, validation.values) : [],
    issues,
  };
}
