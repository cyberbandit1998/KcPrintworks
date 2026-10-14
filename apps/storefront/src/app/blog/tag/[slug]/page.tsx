import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogArchive } from '@/components/blog/BlogArchive';
import { loadArchive } from '@/lib/blog';
import { parsePage } from '@/lib/catalog/queries';
import { listHref, type ListSearchParams } from '@/lib/list-url';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<ListSearchParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = parsePage((await searchParams).page);
  // The same page the visitor gets, from the same cache: an outage message is then kept out of search results.
  const result = await loadArchive({ kind: 'tag', slug, page });
  const name = result.status === 'ok' ? result.term?.name : undefined;
  return {
    title: name ? (page > 1 ? `${name}, blog page ${page}` : `${name} posts`) : 'Blog',
    // Tag pages repeat what the category pages and the index already list: readers may use them, search engines need not.
    robots: { index: false, follow: true },
    alternates: { canonical: listHref(`/blog/tag/${slug}/`, { page }) },
  };
}

export default async function BlogTagPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const page = parsePage((await searchParams).page);
  const result = await loadArchive({ kind: 'tag', slug, page });
  if (result.status === 'not-found') notFound();
  const name = result.status === 'ok' ? (result.term?.name ?? slug) : 'Tag';
  return (
    <BlogArchive
      result={result}
      path={`/blog/tag/${slug}/`}
      title={`Tagged: ${name}`}
      crumbs={[{ name: 'Home', href: '/' }, { name: 'Blog', href: '/blog/' }, { name }]}
    />
  );
}
