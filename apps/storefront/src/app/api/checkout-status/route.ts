import { NextResponse } from 'next/server';
import { currentCheckoutStatus } from '@/lib/checkout';
import { NO_STORE } from '@/lib/http';
import { checkShop } from '@/lib/handoff/shop-guard';
import { isProduction, siteEnv, siteUrl } from '@/lib/env';

/**
 * Is checkout switched on, and if so can this container reach the shop's kcpw-core plugin with a signature it accepts?
 * For the operator's checklists (docs/CHECKOUT-STAGING-CHECKLIST.md, docs/CHECKOUT-PRODUCTION.md). `allowed` is exactly what the handoff
 * route decides for the next shopper (it runs the same shop guard). No secret, no shop address, no customer data in the answer.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = currentCheckoutStatus();
  if (!status.enabled) {
    return NextResponse.json(
      {
        enabled: false,
        environment: siteEnv,
        reason: status.reason,
        ...(status.missing ? { missing: status.missing } : {}),
      },
      { headers: NO_STORE },
    );
  }
  const check = await checkShop(status.config, { production: isProduction, siteUrl });
  const shopStatus = check.ok || check.kind !== 'unreachable' ? check.status : undefined;
  return NextResponse.json(
    {
      enabled: true,
      environment: siteEnv,
      storefront: siteUrl,
      allowed: check.ok,
      ...(check.ok
        ? { returnAddress: check.returnAddress }
        : { blocked: check.kind, reason: check.why }),
      shop: shopStatus
        ? {
            reachable: true,
            plugin: shopStatus.plugin,
            woocommerce: shopStatus.woocommerce,
            currency: shopStatus.currency,
            storefrontUrlConfigured: shopStatus.storefrontUrlConfigured,
            storefrontUrl: shopStatus.storefrontUrl ?? null,
            stripeActive: shopStatus.stripeActive,
            stripeTestMode: shopStatus.stripeTestMode,
          }
        : { reachable: false, why: check.ok ? '' : check.why },
    },
    { headers: NO_STORE },
  );
}
