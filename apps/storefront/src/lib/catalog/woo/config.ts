/**
 * WooCommerce connection settings, read from the server environment at request time (never baked into the image, never sent
 * to the browser). The key must be a READ-ONLY WooCommerce REST key; this module can only issue GET requests anyway.
 *
 *   WC_BASE_URL                 https://kcprintworks.com   (https required, except localhost for tests)
 *   WC_CONSUMER_KEY / SECRET    a REST API key with Read permission, created by the site owner in WooCommerce
 *   CATALOG_REVALIDATE_SECONDS  how long a loaded catalog is served before it is refreshed in the background (default 120)
 *   REVALIDATE_SECRET           shared secret that signs the revalidation webhook (see app/api/revalidate)
 */
export interface WooConfig {
  baseUrl: string;
  key: string;
  secret: string;
  ttlSeconds: number;
}

export type WooConfigResult = { ok: true; config: WooConfig } | { ok: false; missing: string[] };

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

export function readWooConfig(
  env: Record<string, string | undefined> = process.env,
): WooConfigResult {
  const missing = ['WC_BASE_URL', 'WC_CONSUMER_KEY', 'WC_CONSUMER_SECRET'].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length > 0) return { ok: false, missing };
  let url: URL;
  try {
    url = new URL(env.WC_BASE_URL!.trim());
  } catch {
    return { ok: false, missing: ['WC_BASE_URL (not a valid URL)'] };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
    return { ok: false, missing: ['WC_BASE_URL (must be https)'] };
  }
  const ttl = Number(env.CATALOG_REVALIDATE_SECONDS);
  return {
    ok: true,
    config: {
      baseUrl: url.origin,
      key: env.WC_CONSUMER_KEY!.trim(),
      secret: env.WC_CONSUMER_SECRET!.trim(),
      ttlSeconds: Number.isFinite(ttl) && ttl >= 5 ? Math.floor(ttl) : 120,
    },
  };
}
