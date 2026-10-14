import { z } from 'zod';
import type { ReviewInput } from '@kcpw/contracts';
import { signedHeaders } from '../handoff/sign';
import type { ReviewSubmitConfig } from './submit-config';

/**
 * Hands a validated review to kcpw-core on the shop host, server to server. The browser never sees this address, the secret, or the
 * raw answer, and nothing in the answer is passed on except which of a few known outcomes it was.
 */
const TIMEOUT_MS = 15_000;
const Answer = z.object({ ok: z.boolean(), status: z.string() });

export type SubmitOutcome =
  | 'received'
  | 'closed'
  | 'verification_required'
  | 'not_found'
  | 'rate_limited'
  | 'rejected'
  | 'unavailable';

export async function submitReviewUpstream(
  config: ReviewSubmitConfig,
  review: ReviewInput,
  clientKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ outcome: SubmitOutcome; why?: string }> {
  const route = '/kcpw/v1/reviews';
  const body = JSON.stringify({ ...review, clientKey });
  let response: Response;
  try {
    response = await fetchImpl(new URL(`/wp-json${route}`, config.apiUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...signedHeaders(config.secret, 'POST', route, body),
      },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      outcome: 'unavailable',
      why: `request failed (${error instanceof Error ? error.name : 'error'})`,
    };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { outcome: 'unavailable', why: `HTTP ${response.status} without JSON` };
  }
  const answer = Answer.safeParse(json);
  const status = answer.success ? answer.data.status : '';
  if (response.status === 200 && answer.success && answer.data.ok && status === 'received') {
    return { outcome: 'received' };
  }
  if (response.status === 401) {
    return {
      outcome: 'unavailable',
      why: 'the shop did not accept the signature (check KCPW_HANDOFF_SECRET)',
    };
  }
  if (response.status === 503) {
    return { outcome: 'unavailable', why: 'the shop says the checkout link is not set up' };
  }
  if (response.status === 404 && status === 'product_not_found') return { outcome: 'not_found' };
  if (response.status === 404) {
    return {
      outcome: 'unavailable',
      why: 'the plugin does not have the reviews route (needs kcpw-core 0.2.0 or newer)',
    };
  }
  if (response.status === 403 && status === 'verification_required')
    return { outcome: 'verification_required' };
  if (response.status === 403 && status === 'reviews_closed') return { outcome: 'closed' };
  if (response.status === 429) return { outcome: 'rate_limited' };
  if (response.status === 400)
    return { outcome: 'rejected', why: `the shop refused the review (${status || 'no status'})` };
  return { outcome: 'unavailable', why: `HTTP ${response.status}` };
}
