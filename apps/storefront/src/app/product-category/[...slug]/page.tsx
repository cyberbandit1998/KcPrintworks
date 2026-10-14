import type { Metadata } from 'next';
import { toSummary } from '@kcpw/contracts';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CategoryChips } from '@/components/CategoryChips';
import { JsonLd } from '@/components/JsonLd';
import { Pagination } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { SortLinks } from '@/components/SortLinks';
import { getCatalog } from '@/lib/catalog';
import {
  ancestorsOf,
  buildCategoryTree,
  findCategoryNode,
  paginate,
  productsInCategoryTree,
  readHiddenCategorySlugs,
  sortProducts,
} from '@/lib/catalog/queries';
import { listHref, readListParams, type ListSearchParams } from '@/lib/list-url';
import { breadcrumbJsonLd } from '@/lib/seo';

type Props = { params: Promise<{ slug: string[] }>; searchParams: Promise<ListSearchParams> };

/** Hidden categories have a better home: the retired New Arrivals category is the computed page; the catch-all goes to the shop. */
const RETIRED_TARGETS: Record<string, string> = { 'new-arrivals': '/new-arrivals/' };

/**
 * `/product-category/<slug>/` is the address. WooCommerce puts a parent in a child's address
 * (`/product-category/game-cases/card-games/`); that form is accepted too and sent to the flat one, so no old link breaks.
 */
async function findCategory(slugPath: string[]) {
  const last = slugPath[slugPath.length - 1];
  if (!last) return undefined;
  const categories = await getCatalog().listAllCategories();
  return { last, categories, category: categories.find((c) => c.slug === last) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const found = await findCategory((await params).slug);
  if (!found?.category) return {};
  const { sort, page } = readListParams(await searchParams);
  const { category } = found;
  return {
    title: page > 1 ? `${category.seo.title}, page ${page}` : category.seo.title,
    description: category.seo.description,
    alternates: { canonical: listHref(`/product-category/${category.slug}/`, { page }) },
    robots:
      category.seo.noindex || sort !== 'recommended' ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const slugPath = (await params).slug;
  const { sort, page } = readListParams(await searchParams);
  const found = await findCategory(slugPath);
  if (!found?.category) notFound();
  const { category, categories, last } = found;

  if (readHiddenCategorySlugs().has(last)) {
    permanentRedirect(RETIRED_TARGETS[last] ?? '/shop/');
  }
  if (slugPath.length !== 1) {
    permanentRedirect(listHref(`/product-category/${last}/`, { sort, page }));
  }

  const products = await getCatalog().listProducts();
  const inTree = productsInCategoryTree(products, categories, category);
  const result = paginate(sortProducts(inTree, sort), page);
  const roots = buildCategoryTree(categories, products, readHiddenCategorySlugs());
  const children = findCategoryNode(roots, category.id)?.children ?? [];
  const trail = [...ancestorsOf(categories, category), category];
  const path = `/product-category/${category.slug}/`;

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Shop', path: '/shop/' },
          ...trail.map((c) => ({ name: c.name, path: `/product-category/${c.slug}/` })),
        ])}
      />
      <Breadcrumbs
        items={[
          { name: 'Home', href: '/' },
          { name: 'Shop', href: '/shop/' },
          ...trail.map((c, i) =>
            i === trail.length - 1
              ? { name: c.name }
              : { name: c.name, href: `/product-category/${c.slug}/` },
          ),
        ]}
      />
      <div className="container">
        <div className="page-header">
          <h1>{category.name}</h1>
          {category.description ? <p>{category.description}</p> : null}
          <p>
            {result.total} {result.total === 1 ? 'product' : 'products'}
          </p>
        </div>
        {children.length > 0 ? (
          <CategoryChips
            label={`${category.name} subcategories`}
            allHref={path}
            allLabel={`All ${category.name}`}
            categories={children.map((n) => n.category)}
          />
        ) : null}
        {result.total === 0 ? (
          <div className="empty-state">
            <p>There are no products in {category.name} yet. Please check back soon.</p>
            <p>
              <Link className="button" href="/shop/">
                Browse all products
              </Link>
            </p>
          </div>
        ) : (
          <>
            <SortLinks path={path} sort={sort} />
            <ProductGrid products={result.items.map(toSummary)} />
            <Pagination path={path} page={result.page} pages={result.pages} sort={sort} />
          </>
        )}
      </div>
    </>
  );
}
