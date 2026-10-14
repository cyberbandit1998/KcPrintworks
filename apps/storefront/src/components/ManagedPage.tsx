import Link from 'next/link';
import { Breadcrumbs } from './Breadcrumbs';
import { ContentHtml } from './ContentHtml';
import { ContentImage } from './ContentImage';
import type { BlogPostSummary, ContentPage } from '@/lib/wp/types';
import { PostGrid } from './blog/PostCard';

/**
 * A page whose words are written in WordPress (Our Story, Contact). `page` is null when WordPress has no published page with the
 * expected address: the page then says so plainly and invents nothing.
 */
export function ManagedPage({
  title,
  page,
  missingText,
  latest,
  cta,
  children,
}: {
  title: string;
  page: ContentPage | null;
  missingText: string;
  latest?: readonly BlogPostSummary[];
  cta?: boolean;
  /** Shown under the WordPress words (the Contact page's email button). */
  children?: React.ReactNode;
}) {
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: title }]} />
      <div className="container">
        <article className="managed-page">
          <h1>{page?.title || title}</h1>
          {page?.image ? (
            <figure className="post__image">
              <ContentImage image={page.image} sizes="(min-width: 60em) 60rem, 100vw" priority />
            </figure>
          ) : null}
          {page ? <ContentHtml html={page.html} /> : <p>{missingText}</p>}
          {children}
        </article>
      </div>
      {latest && latest.length > 0 ? (
        <section className="section" aria-labelledby="page-latest-heading">
          <div className="container">
            <div className="section__header">
              <h2 id="page-latest-heading">From the blog</h2>
              <Link href="/blog/">All posts</Link>
            </div>
            <PostGrid posts={latest} />
          </div>
        </section>
      ) : null}
      {cta ? (
        <section className="section" aria-label="Shop">
          <div className="container managed-cta">
            <Link href="/shop/" className="button">
              Shop Now
            </Link>
          </div>
        </section>
      ) : null}
    </>
  );
}
