import type { Money } from './money';
import type { OptionSchema } from './options';
import type { Product, ProductAttribute, StockStatus, Variation } from './product';

/**
 * What the browser needs to run the purchase form, and nothing else.
 *
 * The product page is a server component; only the purchase form needs client JavaScript. Passing it the whole
 * product would serialize descriptions, SEO blocks, images, SKUs, and every variation into the page. For a
 * product with a 13 x 13 option matrix that is tens of kilobytes of data the form never reads.
 *
 * Variations are sent as compact numeric rows, and rows that are interchangeable (same "Any" pattern, price,
 * and stock status, such as a 169-variation product whose variations are all "Any") collapse to one row.
 * Collapsing is lossless for the form: variation lookup already prefers the first of equals.
 */

export type PurchaseVariation = Pick<
  Variation,
  'id' | 'attributes' | 'price' | 'regularPrice' | 'stockStatus'
>;

export interface CompactVariations {
  currency: string;
  /** Variation attribute slugs in column order. */
  attrs: string[];
  /**
   * One row per variation: `[id, price, regularPrice, stockCode, ...optionIndexPerAttr]`.
   * Prices are minor units (`regularPrice` 0 means none). `stockCode` indexes STOCK_CODES.
   * An option index of -1 means "Any".
   */
  rows: number[][];
}

export interface PurchaseModel {
  id: number;
  name: string;
  type: Product['type'];
  price: Money;
  regularPrice?: Money;
  /** Only the attributes that select a variation. */
  attributes: ProductAttribute[];
  optionSchema: OptionSchema;
  availability: Pick<Product['availability'], 'stockStatus' | 'madeToOrder' | 'leadTimeDays'>;
  variations: CompactVariations;
}

export const STOCK_CODES: readonly StockStatus[] = ['instock', 'outofstock', 'onbackorder'];

/** Option index meaning WooCommerce's "Any". */
const ANY_INDEX = -1;

export function toPurchaseModel(product: Product): PurchaseModel {
  const attributes = product.attributes.filter((a) => a.usedForVariations);
  const currency = product.price.currency;
  const seen = new Set<string>();
  const rows: number[][] = [];
  for (const v of product.variations) {
    const optionIndexes = attributes.map((a) => {
      const value = v.attributes[a.slug];
      return value === '' || value === undefined
        ? ANY_INDEX
        : a.options.findIndex((o) => o.slug === value);
    });
    // A value that is not one of the attribute's options matches nothing the shopper can pick. It must
    // be dropped, not encoded as -1, which would silently turn it into an "Any" variation.
    const unselectable = optionIndexes.some((index, i) => {
      const value = v.attributes[attributes[i]!.slug];
      return index === ANY_INDEX && value !== '' && value !== undefined;
    });
    if (unselectable) continue;
    const body = [
      v.price.amount,
      v.regularPrice?.amount ?? 0,
      STOCK_CODES.indexOf(v.stockStatus),
      ...optionIndexes,
    ];
    const key = body.join(',');
    if (seen.has(key)) continue; // interchangeable with an earlier row: keep the first
    seen.add(key);
    rows.push([v.id, ...body]);
  }
  return {
    id: product.id,
    name: product.name,
    type: product.type,
    price: product.price,
    regularPrice: product.regularPrice,
    attributes,
    optionSchema: product.optionSchema,
    availability: {
      stockStatus: product.availability.stockStatus,
      madeToOrder: product.availability.madeToOrder,
      leadTimeDays: product.availability.leadTimeDays,
    },
    variations: { currency, attrs: attributes.map((a) => a.slug), rows },
  };
}

export function expandVariations(
  model: Pick<PurchaseModel, 'attributes' | 'variations'>,
): PurchaseVariation[] {
  const { currency, attrs, rows } = model.variations;
  return rows.map((row) => {
    const [id, price, regular, stock, ...optionIndexes] = row as [
      number,
      number,
      number,
      number,
      ...number[],
    ];
    const attributes: Record<string, string> = {};
    attrs.forEach((slug, i) => {
      const optionIndex = optionIndexes[i] ?? ANY_INDEX;
      const attr = model.attributes.find((a) => a.slug === slug);
      attributes[slug] = optionIndex === ANY_INDEX ? '' : (attr?.options[optionIndex]?.slug ?? '');
    });
    return {
      id,
      attributes,
      price: { amount: price, currency },
      regularPrice: regular > 0 ? { amount: regular, currency } : undefined,
      stockStatus: STOCK_CODES[stock] ?? 'instock',
    };
  });
}
