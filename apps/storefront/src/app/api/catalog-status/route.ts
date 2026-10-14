import { NextResponse } from 'next/server';
import { catalogSourceName } from '@/lib/env';
import { getWooCatalogService, WooNotConfiguredError } from '@/lib/catalog/woo/source';
import { buildNav, readNavConfig } from '@/lib/nav';
import { reviewsStatus } from '@/lib/reviews';
import { contentStatus } from '@/lib/wp';

/**
 * What the storefront currently shows and how fresh it is, for the freshness check in docs/DEPLOYMENT-VPS.md. It lists
 * only what the public product pages already show (id, address, name, price, last-modified), never a credential, the
 * WooCommerce address, or an error body.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  if (catalogSourceName !== 'woo') {
    return NextResponse.json({ source: catalogSourceName }, { headers: NO_STORE });
  }
  try {
    const service = getWooCatalogService();
    // A failing WooCommerce is reported through `status`, not thrown at the caller.
    const snapshot = await service.cache.get().catch(() => undefined);
    const status = service.status();
    return NextResponse.json(
      {
        source: 'woo',
        status: {
          loadedAt: status.loadedAt === null ? null : new Date(status.loadedAt).toISOString(),
          ageSeconds: status.ageMs === null ? null : Math.round(status.ageMs / 1000),
          refreshIntervalSeconds: Math.round(status.ttlMs / 1000),
          stale: status.stale,
          refreshing: status.refreshing,
          lastError: status.lastError,
          loads: status.loads,
          failures: status.failures,
        },
        // The blog and the WordPress-managed pages (Our Story, Contact): how many answers are cached and whether any is failing.
        content: contentStatus(),
        reviews: reviewsStatus(),
        // Which WooCommerce category each header link resolved to (by slug or id), so a missing one is visible here.
        nav: snapshot ? buildNav(snapshot.categories, readNavConfig()).slots : null,
        counts: snapshot
          ? {
              products: snapshot.products.length,
              categories: snapshot.categories.length,
              featured: snapshot.products.filter((p) => p.featured).length,
              skipped: snapshot.skipped.length,
              rejected: snapshot.rejected.length,
              proposedPersonalization: snapshot.proposedPersonalization,
            }
          : null,
        skipped: snapshot?.skipped ?? [],
        products: (snapshot?.products ?? []).map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          type: p.type,
          price: p.price.amount,
          variations: p.variations.length,
          updatedAt: p.updatedAt,
        })),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof WooNotConfiguredError) {
      return NextResponse.json(
        { source: 'woo', configured: false, missing: error.missing },
        { status: 503, headers: NO_STORE },
      );
    }
    throw error;
  }
}
