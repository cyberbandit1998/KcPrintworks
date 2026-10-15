import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A signed, time-stamped token placed in the quote form when the page is drawn: a cheap bot filter, not a login. A submission needs a
 * token this server signed, at least a few seconds ago and not more than a few hours ago. Nothing is stored on the server; the key is
 * derived from the shared secret (with a purpose of its own, so a review token is not a quote token), so no new secret is needed.
 */
export const MIN_AGE_SECONDS = 5;
export const MAX_AGE_SECONDS = 4 * 60 * 60;

const key = (secret: string) => createHmac('sha256', secret).update('kcpw-quote-form-v1').digest();
const sign = (secret: string, issuedAt: number) =>
  createHmac('sha256', key(secret)).update(String(issuedAt)).digest('hex');

export function issueQuoteFormToken(secret: string, nowMs: number = Date.now()): string {
  const issuedAt = Math.floor(nowMs / 1000);
  return `${issuedAt}.${sign(secret, issuedAt)}`;
}

export type QuoteFormTokenCheck = 'ok' | 'too_fast' | 'expired' | 'invalid';

export function checkQuoteFormToken(
  secret: string,
  token: unknown,
  nowMs: number = Date.now(),
): QuoteFormTokenCheck {
  if (typeof token !== 'string') return 'invalid';
  const match = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return 'invalid';
  const issuedAt = Number(match[1]);
  const expected = Buffer.from(sign(secret, issuedAt));
  const given = Buffer.from(match[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  const age = Math.floor(nowMs / 1000) - issuedAt;
  if (age < 0) return 'invalid';
  if (age < MIN_AGE_SECONDS) return 'too_fast';
  if (age > MAX_AGE_SECONDS) return 'expired';
  return 'ok';
}
