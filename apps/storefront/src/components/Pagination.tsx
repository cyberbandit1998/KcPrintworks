import Link from 'next/link';
import type { SortKey } from '@/lib/catalog/queries';
import { listHref } from '@/lib/list-url';

/** Previous / numbered / next links. Plain links (no JavaScript); the current page is marked for assistive technology. */
export function Pagination({
  path,
  page,
  pages,
  sort,
  pageParam,
  hash,
  hrefFor,
}: {
  path: string;
  page: number;
  pages: number;
  sort?: SortKey;
  /** A different query name than ?page= (a product page's review pages use ?review_page=). */
  pageParam?: string;
  /** Where the page should land (for example #reviews). */
  hash?: string;
  /** Builds the whole address of a page itself (search results carry a query and a filter along). */
  hrefFor?: (page: number) => string;
}) {
  if (pages <= 1) return null;
  const href = (n: number) =>
    hrefFor
      ? hrefFor(n)
      : pageParam
        ? `${path}${n > 1 ? `?${pageParam}=${n}` : ''}${hash ?? ''}`
        : `${listHref(path, { sort, page: n })}${hash ?? ''}`;
  const numbers = new Set<number>([1, pages, page - 1, page, page + 1]);
  const shown = [...numbers].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  shown.forEach((n, index) => {
    const before = shown[index - 1];
    if (before !== undefined && n - before > 1) items.push('gap');
    items.push(n);
  });
  return (
    <nav className="pagination" aria-label="Pagination">
      <ul>
        <li>
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev">
              Previous<span className="visually-hidden"> page</span>
            </Link>
          ) : null}
        </li>
        {items.map((item, index) =>
          item === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <Link href={href(item)} aria-current={item === page ? 'page' : undefined}>
                <span className="visually-hidden">Page </span>
                {item}
              </Link>
            </li>
          ),
        )}
        <li>
          {page < pages ? (
            <Link href={href(page + 1)} rel="next">
              Next<span className="visually-hidden"> page</span>
            </Link>
          ) : null}
        </li>
      </ul>
    </nav>
  );
}
