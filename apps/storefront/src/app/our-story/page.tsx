import type { Metadata } from 'next';
import { ContentUnavailable } from '@/components/ContentUnavailable';
import { ManagedPage } from '@/components/ManagedPage';
import { trimDescription } from '@/lib/seo';
import { withTimeout } from '@/lib/with-timeout';
import { getContent, getContentConfig } from '@/lib/wp';
import type { ContentPage } from '@/lib/wp/types';

/** The words on this page are written in WordPress (a page whose address ends in "our-story"), never here. */
async function loadPage(): Promise<{ page: ContentPage | null } | { unavailable: true }> {
  try {
    return { page: await getContent().getPage(getContentConfig().ourStorySlug) };
  } catch {
    return { unavailable: true };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadPage();
  if ('unavailable' in loaded || !loaded.page) {
    // Not written yet (or not reachable): keep the placeholder out of search results.
    return { title: 'Our Story', robots: { index: false, follow: true } };
  }
  const description = trimDescription(loaded.page.excerpt);
  return {
    title: loaded.page.title || 'Our Story',
    description: description || undefined,
    alternates: { canonical: '/our-story/' },
  };
}

export default async function OurStoryPage() {
  const loaded = await loadPage();
  if ('unavailable' in loaded) return <ContentUnavailable what="This page" />;
  const latest = await withTimeout(getContent().listPosts({ page: 1, perPage: 3 }), 2500, null);
  return (
    <ManagedPage
      title="Our Story"
      page={loaded.page}
      missingText="Our story is coming soon."
      latest={latest?.posts}
      cta
    />
  );
}
