import Link from 'next/link';
import { trimDescription } from '@/lib/seo';
import { plainText } from '@/lib/wp/sanitize';
import type { ContentPage } from '@/lib/wp/types';

/**
 * A short introduction to the WordPress "Our Story" page, using the page's own words (its excerpt, else its opening text).
 * Left out when the page is not written yet: nothing is made up to fill the space.
 */
export function OurStorySection({ page }: { page: ContentPage | null }) {
  if (!page) return null;
  const teaser = trimDescription(page.excerpt || plainText(page.html), 320);
  if (!teaser) return null;
  return (
    <section className="section" aria-labelledby="our-story-heading" data-section="our-story">
      <div className="container home-story">
        <h2 id="our-story-heading">Our Story</h2>
        <p>{teaser}</p>
        <p>
          <Link href="/our-story/" className="button button--secondary">
            Read our story
          </Link>
        </p>
      </div>
    </section>
  );
}
