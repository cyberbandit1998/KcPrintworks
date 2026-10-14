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
  const result = await loadArchive({ kind: 'category', slug, page });
  const name = result.status === 'ok' ? result.term?.name : undefined;
  if (!name) return { title: 'Blog', robots: { index: false, follow: true } };
  return {
    title: page > 1 ? `${name}, blog page ${page}` : `${name} posts`,
    description: `Posts filed under ${name} on the KCPrintWorks blog.`,
    alternates: { canonical: listHref(`/blog/category/${slug}/`, { page }) },
  };
}

export default async function BlogCategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const page = parsePage((await searchParams).page);
  const result = await loadArchive({ kind: 'category', slug, page });
  if (result.status === 'not-found') notFound();
  const name = result.status === 'ok' ? (result.term?.name ?? slug) : 'Category';
  return (
    <BlogArchive
      result={result}
      path={`/blog/category/${slug}/`}
      title={name}
      crumbs={[{ name: 'Home', href: '/' }, { name: 'Blog', href: '/blog/' }, { name }]}
      currentCategory={slug}
    />
  );
}
