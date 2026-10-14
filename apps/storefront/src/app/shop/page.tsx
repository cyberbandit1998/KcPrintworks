import type { Metadata } from 'next';
import { toSummary } from '@kcpw/contracts';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CategoryChips } from '@/components/CategoryChips';
import { Pagination } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { SortLinks } from '@/components/SortLinks';
import { getCatalog } from '@/lib/catalog';
import {
  buildCategoryTree,
  paginate,
  readHiddenCategorySlugs,
  sortProducts,
} from '@/lib/catalog/queries';
import { listHref, readListParams, type ListSearchParams } from '@/lib/list-url';

type Props = { searchParams: Promise<ListSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { sort, page } = readListParams(await searchParams);
  return {
    title: page > 1 ? `Shop all products, page ${page}` : 'Shop all products',
    description: 'Browse all personalized, made-to-order products.',
    // One address per page of results; a re-sorted list is the same products, so it is kept out of search results.
    alternates: { canonical: listHref('/shop/', { page }) },
    robots: sort !== 'recommended' ? { index: false, follow: true } : undefined,
  };
}

export default async function ShopPage({ searchParams }: Props) {
  const { sort, page } = readListParams(await searchParams);
  const catalog = getCatalog();
  const [products, categories] = await Promise.all([
    catalog.listProducts(),
    catalog.listAllCategories(),
  ]);
  const roots = buildCategoryTree(categories, products, readHiddenCategorySlugs());
  const result = paginate(sortProducts(products, sort), page);
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Shop' }]} />
      <div className="container">
        <div className="page-header">
          <h1>Shop all products</h1>
          <p>
            {result.total} {result.total === 1 ? 'product' : 'products'}
          </p>
        </div>
        <CategoryChips
          label="Categories"
          allHref="/shop/"
          allLabel="All products"
          categories={roots.map((n) => n.category)}
        />
        {result.total === 0 ? (
          <p>No products are available right now. Please check back soon.</p>
        ) : (
          <>
            <SortLinks path="/shop/" sort={sort} />
            <ProductGrid products={result.items.map(toSummary)} />
            <Pagination path="/shop/" page={result.page} pages={result.pages} sort={sort} />
          </>
        )}
      </div>
    </>
  );
}
