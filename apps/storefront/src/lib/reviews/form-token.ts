import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A signed, time-stamped token placed in the review form when the product page is drawn. It is a cheap bot filter, not a login:
 * a submission needs a token that this server signed for THIS product, at least a few seconds ago and not more than a couple of
 * hours ago. Nothing is stored on the server. The key is derived from the shared secret, so no new secret is needed.
 */
export const MIN_AGE_SECONDS = 3;
export const MAX_AGE_SECONDS = 2 * 60 * 60;

const key = (secret: string) => createHmac('sha256', secret).update('kcpw-review-form-v1').digest();

const sign = (secret: string, productId: number, issuedAt: number) =>
  createHmac('sha256', key(secret)).update(`${productId}.${issuedAt}`).digest('hex');

export function issueFormToken(
  secret: string,
  productId: number,
  nowMs: number = Date.now(),
): string {
  const issuedAt = Math.floor(nowMs / 1000);
  return `${issuedAt}.${sign(secret, productId, issuedAt)}`;
}

export type FormTokenCheck = 'ok' | 'too_fast' | 'expired' | 'invalid';

export function checkFormToken(
  secret: string,
  productId: number,
  token: unknown,
  nowMs: number = Date.now(),
): FormTokenCheck {
  if (typeof token !== 'string') return 'invalid';
  const match = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return 'invalid';
  const issuedAt = Number(match[1]);
  const expected = Buffer.from(sign(secret, productId, issuedAt));
  const given = Buffer.from(match[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  const age = Math.floor(nowMs / 1000) - issuedAt;
  if (age < 0) return 'invalid';
  if (age < MIN_AGE_SECONDS) return 'too_fast';
  if (age > MAX_AGE_SECONDS) return 'expired';
  return 'ok';
}
