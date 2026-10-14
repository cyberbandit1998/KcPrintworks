/**
 * Hosts whose product photos Next may resize (the image optimizer fetches only from these). WooCommerce serves photos
 * from the store's own host, so the default is the owner's domain and its subdomains (kcprintworks.com, and
 * shop.kcprintworks.com after the move). Another host is added at build time with the IMAGE_HOSTS build argument
 * (comma-separated, `**.example.com` matches any subdomain).
 *
 * A photo on any OTHER host is still shown, just unresized: next/image throws for a host it does not know, and one
 * unexpected photo URL must never turn a product page into an error page.
 */
export const DEFAULT_IMAGE_HOSTS = ['kcprintworks.com', '**.kcprintworks.com'];

export function parseImageHosts(raw: string | undefined): string[] {
  const hosts = (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^(\*\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h));
  return hosts.length > 0 ? hosts : DEFAULT_IMAGE_HOSTS;
}

function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('**.')) return hostname.endsWith(pattern.slice(2));
  return hostname === pattern;
}

/** True when next/image may be asked to resize this URL: a path on this site, or https on an allowed host. */
export function isOptimizableImage(
  url: string,
  hosts: string[] = parseImageHosts(process.env.IMAGE_HOSTS),
): boolean {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      hosts.some((pattern) => hostMatches(parsed.hostname.toLowerCase(), pattern))
    );
  } catch {
    return false;
  }
}
