import { isProduction } from './env';

/**
 * Whether the cart may hand a shopper over to WooCommerce checkout.
 *
 * It is OFF unless an operator turns it on, deliberately, with all of:
 *   CHECKOUT_ENABLED=true       the explicit switch (default off)
 *   KCPW_API_URL                the shop host that runs the kcpw-core plugin, https (plain http only for localhost tests)
 *   KCPW_HANDOFF_SECRET         32+ characters, the same value as KCPW_HANDOFF_SECRET in that site's wp-config.php
 * and it can NEVER be on in a production build (SITE_ENV is written into the build; the VPS environment cannot change it):
 * going live with checkout is a code change that needs the owner's approval. Read at request time, so a staging container
 * can be switched with its .env and no rebuild.
 */
export interface CheckoutConfig {
  apiUrl: string;
  secret: string;
}

export type CheckoutStatus =
  | { enabled: true; config: CheckoutConfig }
  | { enabled: false; reason: string; missing?: string[] };

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

export function readCheckoutStatus(
  env: Record<string, string | undefined> = process.env,
  production: boolean = isProduction,
): CheckoutStatus {
  if (env.CHECKOUT_ENABLED !== 'true') return { enabled: false, reason: 'not turned on' };
  if (production) return { enabled: false, reason: 'not available in a production build' };
  const missing: string[] = [];
  let url: URL | undefined;
  try {
    url = new URL((env.KCPW_API_URL ?? '').trim());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
      missing.push('KCPW_API_URL (must be https)');
    }
  } catch {
    missing.push('KCPW_API_URL');
  }
  const secret = (env.KCPW_HANDOFF_SECRET ?? '').trim();
  if (secret.length < 32) missing.push('KCPW_HANDOFF_SECRET (32 or more characters)');
  if (missing.length > 0 || !url) {
    return { enabled: false, reason: 'not fully configured', missing };
  }
  return { enabled: true, config: { apiUrl: url.origin, secret } };
}
