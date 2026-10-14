import { isProduction, siteUrl } from './env';

/**
 * Whether the cart may hand a shopper over to WooCommerce checkout.
 *
 * It is OFF unless an operator turns it on, deliberately, with all of:
 *   CHECKOUT_ENABLED=true       the explicit switch (default off)
 *   KCPW_API_URL                the shop host that runs the kcpw-core plugin, https (plain http only for localhost tests).
 *                               Falls back to KCPW_SHOP_URL, then to WC_BASE_URL (the shop is the WooCommerce site), so a
 *                               staging container that already reads the catalog needs only the secret.
 *   KCPW_HANDOFF_SECRET         32+ characters, the same value as KCPW_HANDOFF_SECRET in that site's wp-config.php
 *
 * A PRODUCTION build (SITE_ENV=production, written into the build: the VPS environment cannot change it) may also take
 * checkout, but only with the stricter rules below, because real money can follow. Anything not met leaves it off and is named
 * in `missing`; no rule is skipped to make production pass:
 *   - the shop address is https with no exception for "local" hosts, and is not the storefront's own host;
 *   - the storefront address baked into the build (NEXT_PUBLIC_SITE_URL) is a plain https origin, not local;
 *   - CATALOG_SOURCE is `woo`, so the cart is priced from the live catalog and never from sample data.
 * Whether the SHOP agrees (its Stripe mode, the storefront address it returns shoppers to) is checked per request in
 * handoff/shop-guard.ts. Read at request time, so a container can be switched with its .env and no rebuild.
 */
export interface CheckoutConfig {
  apiUrl: string;
  secret: string;
}

export type CheckoutStatus =
  | { enabled: true; config: CheckoutConfig }
  | { enabled: false; reason: string; missing?: string[] };

export const isLocal = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/** Where the shop address may come from, most specific first. An empty value counts as unset (compose passes unset names as empty). */
const SHOP_ADDRESS_NAMES = ['KCPW_API_URL', 'KCPW_SHOP_URL', 'WC_BASE_URL'] as const;

export function shopAddress(env: Record<string, string | undefined>): {
  name: string;
  value: string;
} {
  for (const name of SHOP_ADDRESS_NAMES) {
    const value = (env[name] ?? '').trim();
    if (value) return { name, value };
  }
  return { name: SHOP_ADDRESS_NAMES[0], value: '' };
}

export function readCheckoutStatus(
  env: Record<string, string | undefined> = process.env,
  production: boolean = isProduction,
  site: string = siteUrl,
): CheckoutStatus {
  if (env.CHECKOUT_ENABLED !== 'true') return { enabled: false, reason: 'not turned on' };
  const missing: string[] = [];
  let url: URL | undefined;
  const address = shopAddress(env);
  try {
    url = new URL(address.value);
    if (production) {
      if (url.protocol !== 'https:' || isLocal(url.hostname)) {
        missing.push(`${address.name} (must be https in production)`);
      }
    } else if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
      missing.push(`${address.name} (must be https)`);
    }
  } catch {
    missing.push(address.name);
  }
  const secret = (env.KCPW_HANDOFF_SECRET ?? '').trim();
  if (secret.length < 32) missing.push('KCPW_HANDOFF_SECRET (32 or more characters)');
  if (production) {
    // Fixed when the image was built, so these cannot be repaired from the container's .env: they name the build.
    const storefront = httpsOrigin(site);
    if (!storefront || isLocal(new URL(storefront).hostname) || site !== storefront) {
      missing.push('NEXT_PUBLIC_SITE_URL (set when the image was built; must be an https origin)');
    } else if (url && url.host === new URL(storefront).host) {
      missing.push(`${address.name} (the shop must be a different host from the storefront)`);
    }
    if (env.CATALOG_SOURCE !== 'woo') missing.push('CATALOG_SOURCE (must be woo in production)');
  }
  if (missing.length > 0 || !url) {
    return { enabled: false, reason: 'not fully configured', missing };
  }
  return { enabled: true, config: { apiUrl: url.origin, secret } };
}

/** `https://host[:port]` for an https address, else undefined. */
function httpsOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

const reported = new Set<string>();

/**
 * `readCheckoutStatus()` on the live environment, and, when an operator switched checkout on but it stays off, one line in the
 * server log saying why (names of missing settings only, never values). Without it a half-configured container just shows a
 * disabled button and nothing explains it.
 */
export function currentCheckoutStatus(): CheckoutStatus {
  const status = readCheckoutStatus();
  if (!status.enabled && process.env.CHECKOUT_ENABLED === 'true') {
    const why = `${status.reason}${status.missing ? `: ${status.missing.join(', ')}` : ''}`;
    if (!reported.has(why)) {
      reported.add(why);
      console.warn(`[checkout] CHECKOUT_ENABLED is true but checkout stays off (${why}).`);
    }
  }
  return status;
}
