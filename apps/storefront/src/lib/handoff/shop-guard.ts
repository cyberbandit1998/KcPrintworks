import type { CheckoutConfig } from '../checkout';
import { requestShopStatus, type ShopStatus } from './upstream';

/**
 * Checked on every handoff, after the cart itself is valid and before the shop is asked for a checkout link. Two mistakes
 * would otherwise cost real money or send a shopper to the wrong site, and neither can be seen from this container's own
 * settings, only from what the shop reports about itself (a signed GET, answered by kcpw-core):
 *
 *   - A STAGING or development build must never reach a shop that is taking real payments. Staging and production share one
 *     WooCommerce site, so the day Stripe is switched to live mode a forgotten CHECKOUT_ENABLED on staging would charge cards.
 *     It therefore proceeds only while the shop positively reports Stripe in TEST mode; anything else, "live", "no Stripe",
 *     or "no answer", is a refusal.
 *   - A PRODUCTION build must not hand shoppers to a shop that returns them to some other storefront (for example the staging
 *     address left in KCPW_STOREFRONT_URL). A different reported address is a refusal. A shop that does not report one (the
 *     0.2.0 plugin) cannot be checked: that is allowed but flagged in the status page, because it only affects where an error
 *     sends the shopper, never a payment.
 *
 * The answer is never cached: a mode change at the shop must apply to the very next click.
 */
export type ShopCheck =
  | { ok: true; status: ShopStatus; returnAddress: 'matches' | 'not_reported' | 'not_checked' }
  | { ok: false; kind: 'unreachable'; why: string }
  | {
      ok: false;
      kind: 'live_mode_blocked' | 'return_address_mismatch';
      why: string;
      status: ShopStatus;
    };

export interface GuardContext {
  production: boolean;
  /** This build's own public address (NEXT_PUBLIC_SITE_URL). */
  siteUrl: string;
}

const originOf = (value: string): string | undefined => {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

export async function checkShop(
  config: CheckoutConfig,
  context: GuardContext,
  fetchImpl: typeof fetch = fetch,
): Promise<ShopCheck> {
  const shop = await requestShopStatus(config, fetchImpl);
  if (!shop.reachable) return { ok: false, kind: 'unreachable', why: shop.why };
  const { status } = shop;

  if (!context.production) {
    if (status.stripeTestMode !== true) {
      return {
        ok: false,
        kind: 'live_mode_blocked',
        status,
        why:
          status.stripeTestMode === false
            ? 'this is not a production build and the shop reports Stripe in LIVE mode'
            : 'this is not a production build and the shop does not report Stripe in test mode',
      };
    }
    return { ok: true, status, returnAddress: 'not_checked' };
  }

  const reported = status.storefrontUrl;
  if (!reported) return { ok: true, status, returnAddress: 'not_reported' };
  if (originOf(reported) !== originOf(context.siteUrl)) {
    return {
      ok: false,
      kind: 'return_address_mismatch',
      status,
      why: 'the shop returns shoppers to a different storefront address than this build (set KCPW_STOREFRONT_URL in the shop wp-config.php)',
    };
  }
  return { ok: true, status, returnAddress: 'matches' };
}
