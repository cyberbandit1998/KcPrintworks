import { validateReviewInput } from '@kcpw/contracts';
import { clientAddress, clientKey } from './client-key';
import { checkFormToken } from './form-token';
import type { ReviewApiResponse } from './api-types';
import { RateLimiter } from './rate-limit';
import type { ReviewSubmitStatus } from './submit-config';
import { submitReviewUpstream, type SubmitOutcome } from './submit-upstream';
import { readBodyLimited } from '../http';

/**
 * "Save my review." The browser sends a handful of fields; this server decides whether to pass them on:
 *   same site only, JSON only, small, a form token this server signed for that product (a few seconds to two hours old), an empty
 *   hidden field, the same validation the form ran, a product the shop lists with reviews on, and a per-visitor and overall limit.
 * Only then does it ask kcpw-core to save the review as PENDING. It never publishes anything, never sees an approval, and never
 * accepts a "verified" claim. Nothing about the shopper is logged.
 */
const MAX_BODY_BYTES = 8_000;

export interface ReviewHandlerDeps {
  status: ReviewSubmitStatus;
  /** True when the shop lists this product with reviews switched on. */
  productAcceptsReviews: (productId: number) => Promise<boolean>;
  perClient: RateLimiter;
  overall: RateLimiter;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export interface HandlerReply {
  body: ReviewApiResponse;
  status: number;
  headers?: Record<string, string>;
}

const fail = (
  status: number,
  code: Exclude<ReviewApiResponse, { ok: true } | { code: 'invalid' }>['code'],
  message: string,
  headers?: Record<string, string>,
): HandlerReply => ({ status, body: { ok: false, code, message }, headers });

/** The browser must be on the same site: an Origin (or, failing that, Referer) host must equal the Host the request came to. */
export function sameSite(request: Request): boolean {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!host || !source) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

const OUTCOMES: Record<Exclude<SubmitOutcome, 'received'>, HandlerReply> = {
  closed: fail(403, 'closed', 'Reviews are closed for this product.'),
  verification_required: fail(
    403,
    'verification_required',
    'Only customers who bought this product can review it. Please use the email address from your order.',
  ),
  not_found: fail(404, 'closed', 'Reviews are closed for this product.'),
  rate_limited: fail(429, 'rate_limited', 'Too many reviews were sent. Please try again later.', {
    'Retry-After': '3600',
  }),
  rejected: fail(
    503,
    'unavailable',
    'We could not save your review right now. Please try again later.',
  ),
  unavailable: fail(
    503,
    'unavailable',
    'We could not save your review right now. Please try again later.',
  ),
};

export async function handleReviewSubmission(
  request: Request,
  deps: ReviewHandlerDeps,
): Promise<HandlerReply> {
  if (!deps.status.enabled) return fail(404, 'disabled', 'Reviews cannot be written here yet.');
  const { config } = deps.status;
  const now = deps.now?.() ?? Date.now();

  if (!sameSite(request)) return fail(403, 'form_expired', 'Please reload the page and try again.');
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(415, 'form_expired', 'Please reload the page and try again.');
  }
  const raw = await readBodyLimited(request, MAX_BODY_BYTES);
  if (raw === null) return fail(413, 'form_expired', 'Your review is too long to send.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return fail(400, 'form_expired', 'Please reload the page and try again.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(400, 'form_expired', 'Please reload the page and try again.');
  }
  const { website, formToken, ...fields } = parsed as Record<string, unknown>;

  // The hidden field no person sees. A robot fills it in; it is told everything went well and nothing is sent anywhere.
  if (typeof website === 'string' && website.trim() !== '')
    return { status: 200, body: { ok: true } };

  const validation = validateReviewInput(fields);
  if (!validation.ok) {
    // Fields this form does not have are not the shopper's mistake: refuse them as a malformed request.
    if (
      validation.issues.some(
        (issue) => issue.code === 'unknown_field' || issue.code === 'invalid_type',
      )
    ) {
      return fail(400, 'form_expired', 'Please reload the page and try again.');
    }
    return {
      status: 400,
      body: {
        ok: false,
        code: 'invalid',
        errors: validation.issues.map(({ field, message }) => ({ field, message })),
      },
    };
  }
  const review = validation.value;

  const token = checkFormToken(config.secret, review.productId, formToken, now);
  if (token === 'invalid' || token === 'expired') {
    return fail(
      400,
      'form_expired',
      'This form has expired. Please reload the page and try again.',
    );
  }
  if (token === 'too_fast') {
    return fail(429, 'try_again', 'That was quick! Please check your review and send it again.');
  }

  const address = clientAddress(request.headers);
  const hashedAddress = clientKey(config.secret, address);
  const own = deps.perClient.hit(hashedAddress);
  const all = deps.overall.hit('all');
  if (!own.allowed || !all.allowed) {
    const retry = Math.max(
      own.allowed ? 0 : own.retryAfterSeconds,
      all.allowed ? 0 : all.retryAfterSeconds,
    );
    return fail(429, 'rate_limited', 'Too many reviews were sent. Please try again later.', {
      'Retry-After': String(retry),
    });
  }

  let accepts: boolean;
  try {
    accepts = await deps.productAcceptsReviews(review.productId);
  } catch {
    return fail(
      503,
      'unavailable',
      'We could not save your review right now. Please try again later.',
    );
  }
  if (!accepts) return fail(404, 'closed', 'Reviews are closed for this product.');

  const result = await submitReviewUpstream(config, review, hashedAddress, deps.fetchImpl);
  if (result.outcome === 'received') return { status: 200, body: { ok: true } };
  if (result.why) deps.log?.(`[reviews] submission not saved: ${result.why}`);
  return OUTCOMES[result.outcome];
}
