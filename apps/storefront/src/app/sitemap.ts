import type { MetadataRoute } from 'next';
import { getCatalog } from '@/lib/catalog';
import { absoluteUrl } from '@/lib/seo';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = getCatalog();
  const [products, categories] = await Promise.all([
    catalog.listProducts(),
    catalog.listCategories(),
  ]);
  return [
    { url: absoluteUrl('/') },
    { url: absoluteUrl('/shop/') },
    ...categories
      .filter((c) => !c.seo.noindex)
      .map((c) => ({ url: absoluteUrl(`/product-category/${c.slug}/`) })),
    ...products
      .filter((p) => !p.seo.noindex)
      .map((p) => ({ url: absoluteUrl(`/product/${p.slug}/`), lastModified: p.updatedAt })),
  ];
}
