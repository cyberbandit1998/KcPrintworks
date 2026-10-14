import {
  addMoney,
  priceLine,
  zero,
  type CartLineIntent,
  type QuoteIssue,
  type QuoteResponse,
} from '@kcpw/contracts';
import type { CatalogSource } from '@/lib/catalog';

/**
 * The storefront's own price check, from the catalog it is showing. Used for the cart page (display) and, at checkout, to
 * learn what subtotal THIS server believes so kcpw-core can say whether WooCommerce disagrees. WooCommerce stays the
 * authority: the figure computed here is only ever compared with WooCommerce's, never used to charge anyone.
 */
export async function buildQuote(
  catalog: CatalogSource,
  lines: CartLineIntent[],
  coupon?: string,
): Promise<QuoteResponse> {
  const priced = await Promise.all(
    lines.map(async (intent) => priceLine(await catalog.getProductById(intent.productId), intent)),
  );
  const issues: QuoteIssue[] = [];
  if (coupon) {
    issues.push({ code: 'coupon_invalid', message: 'Coupons are not available in this preview.' });
  }
  const currency = priced[0]?.unitPrice.currency ?? 'USD';
  const subtotal = priced
    .filter((l) => l.issues.length === 0)
    .reduce((sum, l) => addMoney(sum, l.lineTotal), zero(currency));
  return {
    lines: priced,
    subtotal,
    issues,
    checkoutReady:
      priced.length > 0 && priced.every((l) => l.issues.length === 0) && issues.length === 0,
    note: 'Shipping, tax, and any discounts are calculated at checkout.',
  };
}
