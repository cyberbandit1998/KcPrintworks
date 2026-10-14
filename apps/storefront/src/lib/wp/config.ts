/**
 * WordPress content settings, read from the server environment at request time.
 *
 *   WP_BASE_URL            the WordPress site (https). Default: WC_BASE_URL (the shop IS the WordPress site).
 *   OUR_STORY_SLUG         the WordPress page shown at /our-story/. Default: our-story
 *   CONTACT_PAGE_SLUG      the WordPress page shown at /contact/. Default: contact
 *   BLOG_PER_PAGE          posts per page on /blog/ (3 to 24). Default: 9
 *   CATALOG_REVALIDATE_SECONDS  how long WordPress answers are kept before a background refresh (default 120)
 *
 * Published posts and pages are public in WordPress, so no credential is used or needed for them. The storefront never
 * changes anything in WordPress.
 */
export interface WpConfig {
  baseUrl: string;
  ttlSeconds: number;
  ourStorySlug: string;
  contactSlug: string;
  postsPerPage: number;
}

export type WpConfigResult = { ok: true; config: WpConfig } | { ok: false; missing: string[] };

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readWpConfig(
  env: Record<string, string | undefined> = process.env,
): WpConfigResult {
  const raw = (env.WP_BASE_URL ?? '').trim() || (env.WC_BASE_URL ?? '').trim();
  if (!raw) return { ok: false, missing: ['WP_BASE_URL (or WC_BASE_URL)'] };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, missing: ['WP_BASE_URL (not a valid URL)'] };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
    return { ok: false, missing: ['WP_BASE_URL (must be https)'] };
  }
  const ttl = Number(env.CATALOG_REVALIDATE_SECONDS);
  const perPage = Number(env.BLOG_PER_PAGE);
  const slug = (value: string | undefined, fallback: string) => {
    const text = (value ?? '').trim().toLowerCase();
    return SLUG.test(text) ? text : fallback;
  };
  return {
    ok: true,
    config: {
      baseUrl: url.origin,
      ttlSeconds: Number.isFinite(ttl) && ttl >= 5 ? Math.floor(ttl) : 120,
      ourStorySlug: slug(env.OUR_STORY_SLUG, 'our-story'),
      contactSlug: slug(env.CONTACT_PAGE_SLUG, 'contact'),
      postsPerPage: Number.isInteger(perPage) && perPage >= 3 && perPage <= 24 ? perPage : 9,
    },
  };
}
