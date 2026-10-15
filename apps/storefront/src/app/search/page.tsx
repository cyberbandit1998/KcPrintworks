import type { Metadata } from 'next';
import Link from 'next/link';
import { toSummary } from '@kcpw/contracts';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Pagination } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { getCatalog } from '@/lib/catalog';
import {
  buildCategoryTree,
  descendantIds,
  paginate,
  parsePage,
  readHiddenCategorySlugs,
  type CategoryNode,
} from '@/lib/catalog/queries';
import { getSearchIndex, searchProducts } from '@/lib/search/index';
import { cleanQuery } from '@/lib/search/hit';
import { quoteHref, searchHref } from '@/lib/search/url';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Result pages are never indexed: they are thin, endless variations of the shop that search engines should reach through the shop itself. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = cleanQuery((await searchParams).q);
  return {
    title: q ? `Search results for “${q}”` : 'Search',
    description: 'Search KCPrintWorks game cases, personalized gifts and more.',
    alternates: { canonical: '/search/' },
    robots: { index: false, follow: true },
  };
}

function flattenNodes(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(depth < 1 ? flattenNodes(node.children, depth + 1) : []),
  ]);
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = cleanQuery(params.q);
  const categorySlug = typeof params.category === 'string' ? params.category.slice(0, 80) : '';
  const page = parsePage(params.page);

  const catalog = getCatalog();
  const [products, categories] = await Promise.all([
    catalog.listProducts(),
    catalog.listAllCategories(),
  ]);
  const hidden = readHiddenCategorySlugs();
  const index = getSearchIndex(products, categories);

  const everything = q ? searchProducts(index, q) : { terms: [], hits: [] };
  const roots = buildCategoryTree(
    categories,
    everything.hits.map((h) => h.product),
    hidden,
  );
  const selected = categories.find((c) => c.slug === categorySlug);
  const filtered =
    q && selected
      ? searchProducts(index, q, { categoryIds: descendantIds(categories, selected.id) })
      : everything;
  const result = paginate(
    filtered.hits.map((h) => h.product),
    page,
  );
  const chips = flattenNodes(roots);
  const hasQuery = q !== '';

  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Search' }]} />
      <div className="container search-page">
        <div className="page-header">
          <h1>{hasQuery ? `Search results for “${q}”` : 'Search'}</h1>
          {hasQuery ? (
            <p role="status">
              {result.total} {result.total === 1 ? 'result' : 'results'}
              {selected ? ` in ${selected.name}` : ''}
            </p>
          ) : (
            <p>Find game cases, gifts and more.</p>
          )}
        </div>

        <form className="search-form" action="/search/" method="get" role="search">
          <label htmlFor="search-page-q" className="visually-hidden">
            Search products
          </label>
          <input
            id="search-page-q"
            className="input search-form__input"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search games, cases, gifts..."
            maxLength={80}
            autoComplete="off"
          />
          <button type="submit" className="button">
            Search
          </button>
          {hasQuery ? (
            <Link href="/search/" className="button button--secondary">
              Clear search
            </Link>
          ) : null}
        </form>

        {hasQuery && everything.hits.length > 0 && chips.length > 0 ? (
          <nav aria-label="Filter results by category" className="search-filters">
            <ul className="chips">
              <li>
                <Link
                  className="chip"
                  href={searchHref({ q })}
                  aria-current={selected ? undefined : 'page'}
                >
                  All categories ({everything.hits.length})
                </Link>
              </li>
              {chips.map(({ node, depth }) => (
                <li key={node.category.id}>
                  <Link
                    className={`chip${depth > 0 ? ' chip--sub' : ''}`}
                    href={searchHref({ q, category: node.category.slug })}
                    aria-current={selected?.id === node.category.id ? 'page' : undefined}
                  >
                    {node.category.name} ({node.total})
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {hasQuery && result.total === 0 ? (
          <NoResults q={q} filtered={Boolean(selected) && everything.hits.length > 0} />
        ) : null}

        {result.total > 0 ? (
          <>
            <ProductGrid products={result.items.map(toSummary)} />
            <Pagination
              path="/search/"
              page={result.page}
              pages={result.pages}
              hrefFor={(n) => searchHref({ q, category: selected?.slug, page: n })}
            />
          </>
        ) : null}

        {!hasQuery ? (
          <p>
            Type a game, a case or a gift above, or <Link href="/shop/">browse the whole shop</Link>
            .
          </p>
        ) : null}
      </div>
    </>
  );
}

function NoResults({ q, filtered }: { q: string; filtered: boolean }) {
  return (
    <section className="search-empty" aria-labelledby="search-empty-heading">
      {filtered ? (
        <>
          <h2 id="search-empty-heading">Nothing in this category</h2>
          <p>
            <Link href={searchHref({ q })}>See every category that matches “{q}”</Link>.
          </p>
        </>
      ) : (
        <>
          <h2 id="search-empty-heading">No products match “{q}”</h2>
          <p>Check the spelling, try fewer words, or look through the shop.</p>
          <p>
            <Link href="/shop/">Browse all products</Link>
          </p>
          <div className="search-empty__quote">
            <h3>Can’t find it?</h3>
            <p>We make things to order. Tell us what you are after and we will send you a quote.</p>
            <Link className="button" href={quoteHref(q)}>
              Request a Custom Quote
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
