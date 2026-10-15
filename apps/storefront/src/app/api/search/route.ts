import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/catalog';
import { readHiddenCategorySlugs } from '@/lib/catalog/queries';
import { NO_STORE } from '@/lib/http';
import { clientAddress } from '@/lib/reviews/client-key';
import { RateLimiter } from '@/lib/reviews/rate-limit';
import { cleanQuery, toHitDto } from '@/lib/search/hit';
import { getSearchIndex, searchProducts } from '@/lib/search/index';

export const dynamic = 'force-dynamic';

/**
 * Live search for the header panel. Answers from the catalog held in memory (no request to WooCommerce or WordPress), returns at most
 * eight small rows, and is limited per visitor so it cannot be used to hammer the server. Nothing about the visitor or the query is stored.
 */
const KEY = Symbol.for('kcpw.searchLimiter');
type Holder = typeof globalThis & { [KEY]?: RateLimiter };
const limiter = () => ((globalThis as Holder)[KEY] ??= new RateLimiter(120, 60_000, 5000));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = cleanQuery(url.searchParams.get('q'));
  const limit = Math.min(8, Math.max(1, Number(url.searchParams.get('limit')) || 6));
  const own = limiter().hit(clientAddress(request.headers));
  if (!own.allowed) {
    return NextResponse.json(
      { query, total: 0, hits: [] },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(own.retryAfterSeconds) } },
    );
  }
  if (query.length < 2)
    return NextResponse.json({ query, total: 0, hits: [] }, { headers: NO_STORE });
  try {
    const catalog = getCatalog();
    const [products, categories] = await Promise.all([
      catalog.listProducts(),
      catalog.listAllCategories(),
    ]);
    const result = searchProducts(getSearchIndex(products, categories), query);
    const hidden = readHiddenCategorySlugs();
    return NextResponse.json(
      {
        query,
        total: result.hits.length,
        hits: result.hits.slice(0, limit).map((hit) => toHitDto(hit.product, categories, hidden)),
      },
      { headers: NO_STORE },
    );
  } catch {
    // The catalog could not be read at all: say so plainly, never an error page for a search box.
    return NextResponse.json(
      { query, total: 0, hits: [], unavailable: true },
      { status: 503, headers: NO_STORE },
    );
  }
}
