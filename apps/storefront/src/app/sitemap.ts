import type { MetadataRoute } from 'next';
import { getCatalog } from '@/lib/catalog';
import { absoluteUrl } from '@/lib/seo';
import { getContent, getContentConfig } from '@/lib/wp';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = getCatalog();
  const [products, categories] = await Promise.all([
    catalog.listProducts(),
    catalog.listCategories(), // browsable ones only: not hidden, not empty (a parent counts its children's products)
  ]);
  // Blog and page entries come from WordPress. If it cannot be reached the sitemap still lists the shop (a missing entry is
  // better than a failing sitemap).
  const content = getContent();
  const config = getContentConfig();
  const [posts, blogCategories, ourStory, contact] = await Promise.all([
    content.listPostIndex().catch(() => []),
    content.listCategories().catch(() => []),
    content.getPage(config.ourStorySlug).catch(() => null),
    content.getPage(config.contactSlug).catch(() => null),
  ]);
  return [
    { url: absoluteUrl('/') },
    { url: absoluteUrl('/shop/') },
    { url: absoluteUrl('/new-arrivals/') },
    ...(posts.length > 0 ? [{ url: absoluteUrl('/blog/') }] : []),
    ...posts.map((post) => ({
      url: absoluteUrl(`/blog/${post.slug}/`),
      lastModified: post.modifiedAt,
    })),
    ...blogCategories
      .filter((c) => c.count > 0)
      .map((c) => ({ url: absoluteUrl(`/blog/category/${c.slug}/`) })),
    ...(ourStory ? [{ url: absoluteUrl('/our-story/'), lastModified: ourStory.modifiedAt }] : []),
    ...(contact ? [{ url: absoluteUrl('/contact/'), lastModified: contact.modifiedAt }] : []),
    ...categories
      .filter((c) => !c.seo.noindex)
      .map((c) => ({ url: absoluteUrl(`/product-category/${c.slug}/`) })),
    ...products
      .filter((p) => !p.seo.noindex)
      .map((p) => ({ url: absoluteUrl(`/product/${p.slug}/`), lastModified: p.updatedAt })),
  ];
}
