import { NextResponse } from 'next/server';
import { NO_STORE } from '@/lib/http';
import { checkShop } from '@/lib/handoff/shop-guard';
import { isProduction, siteEnv, siteUrl } from '@/lib/env';
import { currentQuotePaymentStatus, currentQuotesStatus } from '@/lib/quotes/config';

/**
 * Are custom quotes switched on, and may a customer approve and pay one? For the operator's checklist (docs/CUSTOM-QUOTES.md).
 * `requests` is whether /custom-orders/ takes requests. `payments` is whether an emailed quote can be approved and paid: that is
 * checkout, so it also needs CHECKOUT_ENABLED and, on every press, the shop's agreement (the same guard as the cart). Names of missing
 * settings only; no secret, no shop address, no customer data.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const quotes = currentQuotesStatus();
  const requests = quotes.enabled
    ? { enabled: true }
    : {
        enabled: false,
        reason: quotes.reason,
        ...(quotes.missing ? { missing: quotes.missing } : {}),
      };
  const payments = currentQuotePaymentStatus();
  if (!payments.enabled) {
    return NextResponse.json(
      { environment: siteEnv, requests, payments: { enabled: false, reason: payments.reason } },
      { headers: NO_STORE },
    );
  }
  const check = await checkShop(payments.config, { production: isProduction, siteUrl });
  return NextResponse.json(
    {
      environment: siteEnv,
      requests,
      payments: {
        enabled: true,
        allowed: check.ok,
        ...(check.ok ? {} : { blocked: check.kind, reason: check.why }),
      },
    },
    { headers: NO_STORE },
  );
}
