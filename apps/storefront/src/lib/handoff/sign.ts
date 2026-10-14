import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Request signing toward kcpw-core (server only). Must match wordpress/kcpw-core/src/Auth/RequestSigner.php; the shared
 * vectors in packages/contracts/test/vectors/signing.json prove it.
 *
 *   canonical = "KCPW1" \n timestamp \n nonce \n METHOD \n route \n sha256hex(body)
 *   signature = hex(HMAC-SHA256(secret, canonical))
 */
export function canonicalString(parts: {
  timestamp: string;
  nonce: string;
  method: string;
  route: string;
  body: string;
}): string {
  const bodyHash = createHash('sha256').update(Buffer.from(parts.body, 'utf8')).digest('hex');
  return [
    'KCPW1',
    parts.timestamp,
    parts.nonce,
    parts.method.toUpperCase(),
    parts.route,
    bodyHash,
  ].join('\n');
}

export function signRequest(
  secret: string,
  parts: { timestamp: string; nonce: string; method: string; route: string; body: string },
): string {
  return createHmac('sha256', secret).update(canonicalString(parts), 'utf8').digest('hex');
}

/** The three headers for one request. The nonce is fresh every time, so a captured request cannot be replayed. */
export function signedHeaders(
  secret: string,
  method: string,
  route: string,
  body: string,
  now: Date = new Date(),
  nonce: string = randomBytes(18).toString('base64url'),
): Record<string, string> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    'x-kcpw-timestamp': timestamp,
    'x-kcpw-nonce': nonce,
    'x-kcpw-signature': signRequest(secret, { timestamp, nonce, method, route, body }),
  };
}
