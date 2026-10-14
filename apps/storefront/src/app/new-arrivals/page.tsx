import type { Metadata } from 'next';
import { toSummary } from '@kcpw/contracts';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Pagination } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { getCatalog } from '@/lib/catalog';
import { newArrivals, paginate } from '@/lib/catalog/queries';
import { listHref, readListParams, type ListSearchParams } from '@/lib/list-url';

type Props = { searchParams: Promise<ListSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { page } = readListParams(await searchParams);
  return {
    title: page > 1 ? `New Arrivals, page ${page}` : 'New Arrivals',
    description: 'The newest products from KCPrintWorks, most recently published first.',
    alternates: { canonical: listHref('/new-arrivals/', { page }) },
  };
}

/**
 * Newest published products first. The order comes from each product's publication date in WooCommerce; the "New Arrivals" product
 * category is never consulted (a plugin on the shop moves products in and out of it), so this page cannot drift from reality.
 */
export default async function NewArrivalsPage({ searchParams }: Props) {
  const { page } = readListParams(await searchParams);
  const products = await getCatalog().listProducts();
  const result = paginate(newArrivals(products), page);
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'New Arrivals' }]} />
      <div className="container">
        <div className="page-header">
          <h1>New Arrivals</h1>
          <p>The newest products first.</p>
        </div>
        {result.total === 0 ? (
          <p>No products are available right now. Please check back soon.</p>
        ) : (
          <>
            <ProductGrid products={result.items.map(toSummary)} />
            <Pagination path="/new-arrivals/" page={result.page} pages={result.pages} />
          </>
        )}
      </div>
    </>
  );
}
