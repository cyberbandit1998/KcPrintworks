import Link from 'next/link';
import type { BlogTerm } from '@/lib/wp/types';

/** Blog categories as links to their own pages, so every filter has a real, shareable address. */
export function BlogCategoryNav({
  categories,
  current,
}: {
  categories: readonly BlogTerm[];
  current?: string;
}) {
  if (categories.length === 0) return null;
  return (
    <nav aria-label="Blog categories">
      <ul className="chips">
        <li>
          <Link
            className="chip"
            href="/blog/"
            aria-current={current === undefined ? 'page' : undefined}
          >
            All posts
          </Link>
        </li>
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              className="chip"
              href={`/blog/category/${category.slug}/`}
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
