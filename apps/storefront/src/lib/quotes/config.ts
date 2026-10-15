import { currentCheckoutStatus, isLocal, shopAddress, type CheckoutConfig } from '../checkout';

/**
 * Whether custom quotes can be requested on the storefront. OFF unless an operator turns it on, deliberately, with all of:
 *   QUOTES_ENABLED=true     the explicit switch (default off)
 *   KCPW_API_URL            the shop host that runs the kcpw-quotes plugin (same fallbacks as checkout: KCPW_SHOP_URL, WC_BASE_URL)
 *   KCPW_HANDOFF_SECRET     32+ characters, the same value as KCPW_HANDOFF_SECRET in that site's wp-config.php (already set for checkout)
 * Nothing new needs to be stored on the storefront: the requests, the pictures and the quotes live in WordPress. Read at request time.
 */
export interface QuotesConfig {
  apiUrl: string;
  secret: string;
}

export type QuotesStatus =
  { enabled: true; config: QuotesConfig } | { enabled: false; reason: string; missing?: string[] };

export function readQuotesStatus(
  env: Record<string, string | undefined> = process.env,
): QuotesStatus {
  if (env.QUOTES_ENABLED !== 'true') return { enabled: false, reason: 'not turned on' };
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

/** `readQuotesStatus()` on the live environment, with one log line (names only, never values) when it was switched on but stays off. */
export function currentQuotesStatus(): QuotesStatus {
  const status = readQuotesStatus();
  if (!status.enabled && process.env.QUOTES_ENABLED === 'true') {
    const why = `${status.reason}${status.missing ? `: ${status.missing.join(', ')}` : ''}`;
    if (!reported.has(why)) {
      reported.add(why);
      console.warn(`[quotes] QUOTES_ENABLED is true but custom quotes stay off (${why}).`);
    }
  }
  return status;
}

export const quotesEnabled = () => currentQuotesStatus().enabled;

/** The address people can write to when the form is not available. */
export const QUOTES_EMAIL = 'contact@kcprintworks.com';

/** The shop's own time zone, for "today" (a deadline may not be in the past). */
export const shopTimeZone = () => process.env.QUOTES_TIMEZONE || 'America/Detroit';

export function todayInShop(now: Date = new Date(), zone: string = shopTimeZone()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Approving a quote and paying it IS checkout, so it needs everything checkout needs (CHECKOUT_ENABLED and its stricter production
 * rules, in checkout.ts) as well as QUOTES_ENABLED. Looking at a quote does not: a customer holding an emailed quote can always read it.
 * This is deliberate (CLAUDE.md rule 2): turning quotes on never turns payments on by itself.
 */
export type QuotePaymentStatus =
  { enabled: true; config: CheckoutConfig } | { enabled: false; reason: string };

export function currentQuotePaymentStatus(): QuotePaymentStatus {
  if (!currentQuotesStatus().enabled) return { enabled: false, reason: 'quotes are not turned on' };
  const checkout = currentCheckoutStatus();
  if (!checkout.enabled) return { enabled: false, reason: 'checkout is not turned on' };
  return { enabled: true, config: checkout.config };
}
