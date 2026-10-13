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

export type CatalogSourceName = 'fixtures' | 'woo' | 'export';

/** `export` (design preview from a local WooCommerce export) is refused in production builds. */
export const catalogSourceName: CatalogSourceName =
  process.env.CATALOG_SOURCE === 'woo'
    ? 'woo'
    : process.env.CATALOG_SOURCE === 'export' && !isProduction
      ? 'export'
      : 'fixtures';
