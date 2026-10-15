/**
 * The address WooCommerce gives for paying an order. It comes from another server, and the shopper is about to be sent there with a card in
 * hand, so it is checked before it is trusted: https (plain http only for a local test shop), exactly the shop's own origin, no
 * credentials, no fragment, and WooCommerce's "Pay for order" page (a path ending /order-pay/<number>/ or the ?order-pay=<number> form).
 * Anything else is dropped, and the shopper is told to try again rather than being sent somewhere unexpected.
 */
export function safePayUrl(value: unknown, shopOrigin: string): string | undefined {
  if (typeof value !== 'string' || value.length > 600) return undefined;
  let url: URL;
  let shop: URL;
  try {
    url = new URL(value);
    shop = new URL(shopOrigin);
  } catch {
    return undefined;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(shop.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return undefined;
  if (url.origin !== shop.origin) return undefined;
  if (url.username || url.password || url.hash) return undefined;
  const pretty = /\/order-pay\/\d{1,12}\/?$/.test(url.pathname);
  const plain = /^\d{1,12}$/.test(url.searchParams.get('order-pay') ?? '');
  if (!pretty && !plain) return undefined;
  return url.toString();
}
