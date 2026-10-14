import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature check for POST /api/revalidate/. The signature is HMAC-SHA256 of the raw request body with REVALIDATE_SECRET.
 * Two encodings are accepted so both senders work with one secret:
 *   - `X-WC-Webhook-Signature: <base64>`   what a WooCommerce webhook sends (secret = the webhook's "Secret")
 *   - `X-KCPW-Signature: sha256=<hex>`     what scripts/verify-catalog-freshness.mjs sends
 * A missing secret rejects everything (the endpoint is off until it is configured), and comparison is constant-time.
 */
const MIN_SECRET_LENGTH = 16;

export function sign(body: string | Buffer, secret: string): { base64: string; hex: string } {
  const digest = createHmac('sha256', secret).update(body).digest();
  return { base64: digest.toString('base64'), hex: digest.toString('hex') };
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type SignatureResult = 'ok' | 'not_configured' | 'missing' | 'invalid';

export function checkSignature(
  body: string | Buffer,
  headers: { get(name: string): string | null },
  secret: string | undefined,
): SignatureResult {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return 'not_configured';
  const wc = headers.get('x-wc-webhook-signature');
  const own = headers.get('x-kcpw-signature');
  if (!wc && !own) return 'missing';
  const expected = sign(body, secret);
  if (wc && equal(wc.trim(), expected.base64)) return 'ok';
  if (
    own &&
    equal(
      own
        .trim()
        .replace(/^sha256=/i, '')
        .toLowerCase(),
      expected.hex,
    )
  )
    return 'ok';
  return 'invalid';
}
