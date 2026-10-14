import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlogArchive } from '@/components/blog/BlogArchive';
import { loadArchive } from '@/lib/blog';
import { parsePage } from '@/lib/catalog/queries';
import { listHref, type ListSearchParams } from '@/lib/list-url';

type Props = { searchParams: Promise<ListSearchParams> };

const INTRO = 'News, stories, and ideas from the KCPrintWorks workshop.';

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  // Answered from the same cache as the page itself. An outage message is kept out of search results.
  const result = await loadArchive({ kind: 'all', page });
  return {
    title: page > 1 ? `Blog, page ${page}` : 'Blog',
    description: INTRO,
    // One address per page of posts.
    alternates: { canonical: listHref('/blog/', { page }) },
    robots: result.status === 'unavailable' ? { index: false, follow: true } : undefined,
  };
}

export default async function BlogPage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const result = await loadArchive({ kind: 'all', page });
  if (result.status === 'not-found') notFound();
  return (
    <BlogArchive
      result={result}
      path="/blog/"
      title="Blog"
      intro={INTRO}
      crumbs={[{ name: 'Home', href: '/' }, { name: 'Blog' }]}
    />
  );
}
