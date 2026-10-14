import { isLocal, shopAddress } from '../checkout';

/**
 * Whether shoppers may write a review on the storefront. It is OFF unless an operator turns it on, deliberately, with all of:
 *   REVIEWS_SUBMIT_ENABLED=true   the explicit switch (default off)
 *   KCPW_API_URL                  the shop host that runs kcpw-core 0.2.0 or newer (same fallbacks as checkout: KCPW_SHOP_URL, WC_BASE_URL)
 *   KCPW_HANDOFF_SECRET           32+ characters, the same value as KCPW_HANDOFF_SECRET in that site's wp-config.php
 * Reviews are not published by this: kcpw-core saves each one as PENDING and a person approves it in WordPress. Read at request time.
 */
export interface ReviewSubmitConfig {
  apiUrl: string;
  secret: string;
}

export type ReviewSubmitStatus =
  | { enabled: true; config: ReviewSubmitConfig }
  | { enabled: false; reason: string; missing?: string[] };

export function readReviewSubmitStatus(
  env: Record<string, string | undefined> = process.env,
): ReviewSubmitStatus {
  if (env.REVIEWS_SUBMIT_ENABLED !== 'true') return { enabled: false, reason: 'not turned on' };
  const missing: string[] = [];
  let url: URL | undefined;
  const address = shopAddress(env);
  try {
    url = new URL(address.value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
      missing.push(`${address.name} (must be https)`);
    }
  } catch {
    missing.push(address.name);
  }
  const secret = (env.KCPW_HANDOFF_SECRET ?? '').trim();
  if (secret.length < 32) missing.push('KCPW_HANDOFF_SECRET (32 or more characters)');
  if (missing.length > 0 || !url)
    return { enabled: false, reason: 'not fully configured', missing };
  return { enabled: true, config: { apiUrl: url.origin, secret } };
}

const reported = new Set<string>();

/** `readReviewSubmitStatus()` on the live environment, with one log line (names only, never values) when it was switched on but stays off. */
export function currentReviewSubmitStatus(): ReviewSubmitStatus {
  const status = readReviewSubmitStatus();
  if (!status.enabled && process.env.REVIEWS_SUBMIT_ENABLED === 'true') {
    const why = `${status.reason}${status.missing ? `: ${status.missing.join(', ')}` : ''}`;
    if (!reported.has(why)) {
      reported.add(why);
      console.warn(
        `[reviews] REVIEWS_SUBMIT_ENABLED is true but review submission stays off (${why}).`,
      );
    }
  }
  return status;
}
