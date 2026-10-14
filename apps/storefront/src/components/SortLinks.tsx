import Link from 'next/link';
import { SORT_OPTIONS, type SortKey } from '@/lib/catalog/queries';
import { listHref } from '@/lib/list-url';

/** Sorting as plain links: no JavaScript, each choice has its own address, and the chosen one is marked. */
export function SortLinks({ path, sort }: { path: string; sort: SortKey }) {
  return (
    <nav className="sort-links" aria-label="Sort products">
      <span className="sort-links__label" id="sort-label">
        Sort by
      </span>
      <ul aria-labelledby="sort-label">
        {SORT_OPTIONS.map((option) => (
          <li key={option.key}>
            <Link
              className="chip"
              href={listHref(path, { sort: option.key })}
              aria-current={option.key === sort ? 'true' : undefined}
              rel="nofollow"
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
