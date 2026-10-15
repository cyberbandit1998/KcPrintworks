import { validateQuoteApproval } from '@kcpw/contracts';
import { readBodyLimited } from '../http';
import { clientAddress, clientKey } from '../reviews/client-key';
import { RateLimiter } from '../reviews/rate-limit';
import { sameSite } from '../reviews/submit-handler';
import { checkShop, type GuardContext } from '../handoff/shop-guard';
import { QUOTE_REF, QUOTE_TOKEN, type QuoteApproveResponse } from './api-types';
import type { QuotePaymentStatus } from './config';
import { safePayUrl } from './pay-url';
import { callQuotesPlugin, whyUnavailable } from './upstream';

/**
 * "Approve this quote." The browser sends the secret link's reference and token, the revision it was looking at, a shipping address and the
 * "yes". This server decides whether to pass it on, in this order: payments are switched on (approving IS checkout); same site only; JSON
 * only; small; exactly the known fields (a price, a total or an order number is refused as unknown); the same validation the form ran; a
 * limit per visitor and overall; and the shop itself agreeing it is in a state to take this payment (a staging build never reaches a shop
 * in live Stripe mode: handoff/shop-guard.ts). The plugin then does the real work, with amounts read from its own stored quote, and
 * returns the address of WooCommerce's "Pay for order" page, which is checked before the shopper is sent there.
 */
const MAX_BODY_BYTES = 6_000;

export interface ApproveDeps {
  status: QuotePaymentStatus;
  perClient: RateLimiter;
  overall: RateLimiter;
  guard: GuardContext;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  /** Replaces the shop check in tests that do not care about it. */
  shopCheck?: typeof checkShop;
}

export interface ApproveReply {
  body: QuoteApproveResponse;
  status: number;
  headers?: Record<string, string>;
}

type FailCode = Exclude<QuoteApproveResponse, { ok: true } | { code: 'invalid' }>['code'];

const MESSAGES: Record<FailCode, string> = {
  disabled:
    'Online approval is not open yet. Please reply to your quote email and we will arrange it with you.',
  form_expired: 'Please reload the page and try again.',
  rate_limited: 'Too many attempts were made. Please try again later.',
  invalid_link:
    'This link is not valid. It may have been replaced by a newer quote: please check your latest email.',
  terms_changed:
    'This quote was updated while you were looking at it. Please reload the page to see the current one.',
  expired: 'This quote has expired. Please contact us and we will send a new one.',
  not_open: 'This quote can no longer be approved. Please check your email or contact us.',
  busy: 'Your order is being prepared. Please wait a few seconds and press the button again.',
  unavailable:
    'We could not set up your payment right now. Nothing was charged. Please try again in a little while.',
};

const fail = (status: number, code: FailCode, headers?: Record<string, string>): ApproveReply => ({
  status,
  body: { ok: false, code, message: MESSAGES[code] },
  headers,
});

export async function handleQuoteApproval(
  request: Request,
  deps: ApproveDeps,
): Promise<ApproveReply> {
  const log = deps.log ?? (() => undefined);
  if (!deps.status.enabled) return fail(403, 'disabled');
  const { config } = deps.status;

  if (!sameSite(request)) return fail(403, 'form_expired');
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(415, 'form_expired');
  }
  const raw = await readBodyLimited(request, MAX_BODY_BYTES);
  if (raw === null) return fail(413, 'form_expired');
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return fail(400, 'form_expired');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return fail(400, 'form_expired');
  const keys = Object.keys(body);
  const { ref, token, approval } = body as Record<string, unknown>;
  if (
    keys.length !== 3 ||
    !['ref', 'token', 'approval'].every((k) => keys.includes(k)) ||
    typeof ref !== 'string' ||
    typeof token !== 'string'
  ) {
    return fail(400, 'form_expired');
  }
  if (!QUOTE_REF.test(ref) || !QUOTE_TOKEN.test(token)) return fail(404, 'invalid_link');

  const validation = validateQuoteApproval(approval);
  if (!validation.ok) {
    if (
      validation.issues.some(
        (i) => i.code === 'unknown_field' || (i.code === 'invalid_type' && i.field === ''),
      )
    ) {
      return fail(400, 'form_expired');
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

  const hashed = clientKey(config.secret, clientAddress(request.headers));
  const own = deps.perClient.hit(hashed);
  const all = deps.overall.hit('all');
  if (!own.allowed || !all.allowed) {
    const retry = Math.max(
      own.allowed ? 0 : own.retryAfterSeconds,
      all.allowed ? 0 : all.retryAfterSeconds,
    );
    return fail(429, 'rate_limited', { 'Retry-After': String(retry) });
  }

  const shop = await (deps.shopCheck ?? checkShop)(config, deps.guard, deps.fetchImpl);
  if (!shop.ok) {
    log(`[quotes] approval refused (${shop.kind}): ${shop.why}`);
    return shop.kind === 'unreachable' ? fail(503, 'unavailable') : fail(403, 'disabled');
  }

  const answer = await callQuotesPlugin(
    { apiUrl: config.apiUrl, secret: config.secret },
    '/kcpw-quotes/v1/quote/approve',
    { ref, token, approval: validation.value },
    deps.fetchImpl,
  );
  if (!answer.reached) {
    log(`[quotes] approval not completed: ${answer.why}`);
    return fail(503, 'unavailable');
  }
  const json = (answer.json ?? {}) as { ok?: unknown; status?: unknown; payUrl?: unknown };
  if (answer.status === 200 && json.ok === true) {
    const payUrl = safePayUrl(json.payUrl, config.apiUrl);
    if (!payUrl) {
      log(
        '[quotes] approval completed but the shop gave no usable payment address (not an order-pay address on the shop)',
      );
      return fail(503, 'unavailable');
    }
    return { status: 200, body: { ok: true, payUrl } };
  }
  switch (json.status) {
    case 'invalid_link':
      return fail(404, 'invalid_link');
    case 'terms_changed':
      return fail(409, 'terms_changed');
    case 'expired':
      return fail(410, 'expired');
    case 'not_open':
    case 'not_payable':
      return fail(409, 'not_open');
    case 'busy':
      return fail(409, 'busy');
    case 'invalid_request':
      // The shop disagrees with the checks made here: something is out of date, so ask for a reload rather than guess.
      log('[quotes] approval refused by the shop as invalid after passing the same checks here');
      return fail(400, 'form_expired');
    default:
      log(`[quotes] approval not completed: ${whyUnavailable(answer.status)}`);
      return fail(503, 'unavailable');
  }
}
