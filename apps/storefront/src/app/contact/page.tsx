import type { Metadata } from 'next';
import { ContentUnavailable } from '@/components/ContentUnavailable';
import { ManagedPage } from '@/components/ManagedPage';
import { trimDescription } from '@/lib/seo';
import { getContent, getContentConfig } from '@/lib/wp';
import type { ContentPage } from '@/lib/wp/types';

/** The contact details on this page are written in WordPress (a page whose address ends in "contact"), never here. */
async function loadPage(): Promise<{ page: ContentPage | null } | { unavailable: true }> {
  try {
    return { page: await getContent().getPage(getContentConfig().contactSlug) };
  } catch {
    return { unavailable: true };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const loaded = await loadPage();
  if ('unavailable' in loaded || !loaded.page) {
    return { title: 'Contact', robots: { index: false, follow: true } };
  }
  const description = trimDescription(loaded.page.excerpt);
  return {
    title: loaded.page.title || 'Contact',
    description: description || undefined,
    alternates: { canonical: '/contact/' },
  };
}

export default async function ContactPage() {
  const loaded = await loadPage();
  if ('unavailable' in loaded) return <ContentUnavailable what="This page" />;
  return (
    <ManagedPage
      title="Contact"
      page={loaded.page}
      missingText="Contact details are coming soon."
    />
  );
}
