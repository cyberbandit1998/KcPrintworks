import type { MetadataRoute } from 'next';
import { isProduction } from '@/lib/env';
import { absoluteUrl } from '@/lib/seo';

/** Staging, previews, and local builds disallow everything so unfinished work is never indexed. */
export default function robots(): MetadataRoute.Robots {
  if (!isProduction) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/cart/'] },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
