import { createHmac } from 'node:crypto';

/**
 * Who is submitting, as far as limiting goes. The storefront sits behind a reverse proxy (Nginx Proxy Manager), which sets X-Real-IP
 * to the address it saw and APPENDS that address to X-Forwarded-For, so the LAST entry is the proxy's own observation and anything
 * to its left was written by the client and is ignored. The address is never stored or sent on: only a keyed hash is, so the shop can
 * limit floods per visitor without ever receiving an address.
 */
export function clientAddress(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const last = forwarded.split(',').pop()?.trim();
    if (last) return last;
  }
  return 'unknown';
}

export function clientKey(secret: string, address: string): string {
  return createHmac('sha256', secret).update(`kcpw-review-client|${address}`).digest('hex');
}
