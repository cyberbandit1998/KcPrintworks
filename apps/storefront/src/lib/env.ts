export type SiteEnv = 'development' | 'staging' | 'production';

function parseSiteEnv(value: string | undefined): SiteEnv {
  return value === 'production' || value === 'staging' ? value : 'development';
}

/** Only `production` is indexable. See next.config.ts and app/robots.ts. */
export const siteEnv: SiteEnv = parseSiteEnv(process.env.SITE_ENV);
export const isProduction = siteEnv === 'production';

export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

export const catalogSourceName = process.env.CATALOG_SOURCE === 'woo' ? 'woo' : 'fixtures';
