import { NextResponse } from 'next/server';
import { currentCheckoutStatus } from '@/lib/checkout';
import { NO_STORE } from '@/lib/http';
import { requestShopStatus } from '@/lib/handoff/upstream';

/**
 * Is checkout switched on, and if so can this container reach the shop's kcpw-core plugin with a signature it accepts?
 * For the operator's checklist (docs/CHECKOUT-STAGING-CHECKLIST.md). No secret, no address, no customer data in the answer.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = currentCheckoutStatus();
  if (!status.enabled) {
    return NextResponse.json(
      {
        enabled: false,
        reason: status.reason,
        ...(status.missing ? { missing: status.missing } : {}),
      },
      { headers: NO_STORE },
    );
  }
  const shop = await requestShopStatus(status.config);
  return NextResponse.json(
    {
      enabled: true,
      shop: shop.reachable
        ? {
            reachable: true,
            plugin: shop.status.plugin,
            woocommerce: shop.status.woocommerce,
            currency: shop.status.currency,
            storefrontUrlConfigured: shop.status.storefrontUrlConfigured,
            stripeActive: shop.status.stripeActive,
            stripeTestMode: shop.status.stripeTestMode,
          }
        : { reachable: false, why: shop.why },
    },
    { headers: NO_STORE },
  );
}
