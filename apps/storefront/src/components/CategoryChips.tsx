import Link from 'next/link';
import type { Category } from '@kcpw/contracts/client';

/** Category filters as links to each category's own page (so every filter has a real, shareable address). */
export function CategoryChips({
  label,
  allHref,
  allLabel,
  current,
  categories,
}: {
  label: string;
  allHref?: string;
  allLabel?: string;
  current?: string;
  categories: Pick<Category, 'slug' | 'name'>[];
}) {
  if (categories.length === 0 && !allHref) return null;
  return (
    <nav aria-label={label}>
      <ul className="chips">
        {allHref ? (
          <li>
            <Link
              className="chip"
              href={allHref}
              aria-current={current === undefined ? 'page' : undefined}
            >
              {allLabel ?? 'All'}
            </Link>
          </li>
        ) : null}
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              className="chip"
              href={`/product-category/${category.slug}/`}
              aria-current={current === category.slug ? 'page' : undefined}
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
