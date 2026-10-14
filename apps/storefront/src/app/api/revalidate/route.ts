import { NextResponse } from 'next/server';
import { catalogSourceName } from '@/lib/env';
import { readBodyLimited } from '@/lib/http';
import { checkSignature } from '@/lib/revalidate-auth';
import { getWooCatalogService, WooNotConfiguredError } from '@/lib/catalog/woo/source';

/**
 * "WooCommerce changed, refresh the catalog." Called by a WooCommerce webhook (product created/updated/deleted) or by
 * scripts/verify-catalog-freshness.mjs. It does not change anything in WooCommerce; it only makes this server read the
 * catalog again. The body is never trusted for content: a valid signature is the whole request.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  if (catalogSourceName !== 'woo') {
    return NextResponse.json(
      { error: 'not_applicable', source: catalogSourceName },
      { status: 404, headers: NO_STORE },
    );
  }
  const raw = await readBodyLimited(request, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: NO_STORE });
  }

  const result = checkSignature(raw, request.headers, process.env.REVALIDATE_SECRET);
  if (result === 'not_configured') {
    return NextResponse.json(
      { error: 'revalidation_not_configured' },
      { status: 503, headers: NO_STORE },
    );
  }
  if (result !== 'ok') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  try {
    const service = getWooCatalogService();
    // The next page view waits for the fresh copy; start loading now so that wait is short. A burst of webhooks (a bulk
    // edit) cannot pile up work: loads are single-flight, and a change that arrives mid-load queues exactly one more load.
    service.cache.invalidate({ blocking: true });
    void service.cache.get().catch(() => undefined);
    return NextResponse.json({ ok: true, refreshing: true }, { status: 202, headers: NO_STORE });
  } catch (error) {
    if (error instanceof WooNotConfiguredError) {
      return NextResponse.json(
        { error: 'woocommerce_not_configured' },
        { status: 503, headers: NO_STORE },
      );
    }
    throw error;
  }
}
