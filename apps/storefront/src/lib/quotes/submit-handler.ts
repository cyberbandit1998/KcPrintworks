import { deadlineProblem, validateQuoteRequest } from '@kcpw/contracts';
import { readBodyLimited } from '../http';
import { clientAddress, clientKey } from '../reviews/client-key';
import { RateLimiter } from '../reviews/rate-limit';
import { sameSite } from '../reviews/submit-handler';
import type { QuoteSubmitResponse } from './api-types';
import { QUOTE_REF } from './api-types';
import { todayInShop, type QuotesStatus } from './config';
import { checkQuoteFormToken } from './form-token';
import { prepareUploads, UPLOAD_LIMITS } from './uploads';
import { callQuotesPlugin, whyUnavailable } from './upstream';

/**
 * "Send my quote request." The browser sends a multipart form: the text fields, up to four pictures, a hidden field and a form token.
 * This server decides whether to pass it on, in this order: the quotes feature is on; same site only; multipart only; small; every
 * field known (a price, a status or an order number is refused as unknown); an empty hidden field (a robot that fills it in is told it
 * worked and nothing is sent); the same validation the form ran (shared vectors with the plugin); a deadline that is not in the past;
 * pictures that really are pictures, few and small; a form token this server signed, a few seconds to four hours old; and a limit per
 * visitor and for the whole shop. Only then does the plugin get it, signed, to store as NEW. Nothing about the visitor is logged and the
 * visitor's address never leaves this server: only a keyed hash of it does.
 */
const FIELD_BYTES = 24_000;
export const MAX_BODY_BYTES = UPLOAD_LIMITS.maxTotalBytes + FIELD_BYTES + 262_144;

const TEXT_FIELDS = new Set([
  'name',
  'email',
  'projectType',
  'game',
  'description',
  'dimensions',
  'quantity',
  'colors',
  'deadline',
  'shipTo',
]);

export interface QuoteHandlerDeps {
  status: QuotesStatus;
  perClient: RateLimiter;
  overall: RateLimiter;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export interface QuoteHandlerReply {
  body: QuoteSubmitResponse;
  status: number;
  headers?: Record<string, string>;
}

const fail = (
  status: number,
  code: Exclude<QuoteSubmitResponse, { ok: true } | { code: 'invalid' }>['code'],
  message: string,
  headers?: Record<string, string>,
): QuoteHandlerReply => ({ status, body: { ok: false, code, message }, headers });

const RELOAD = 'Please reload the page and try again.';
const UNAVAILABLE =
  'We could not send your request right now. Please try again in a little while, or email contact@kcprintworks.com.';

/** A plausible reference for a robot, so it learns nothing from the answer. */
const fakeRef = () =>
  `KCQ-${String(new Date().getUTCFullYear()).slice(2)}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-AAAAAA`;

export async function handleQuoteSubmission(
  request: Request,
  deps: QuoteHandlerDeps,
): Promise<QuoteHandlerReply> {
  if (!deps.status.enabled)
    return fail(404, 'disabled', 'Custom quotes cannot be requested here yet.');
  const { config } = deps.status;
  const now = deps.now?.() ?? Date.now();

  if (!sameSite(request)) return fail(403, 'form_expired', RELOAD);
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('multipart/form-data')) return fail(415, 'form_expired', RELOAD);
  const raw = await readBodyLimited(request, MAX_BODY_BYTES);
  if (raw === null) {
    return fail(
      413,
      'too_large',
      'That is more than we can take at once. Please send fewer or smaller pictures.',
    );
  }

  let form: FormData;
  try {
    form = await new Request('http://form.invalid/', {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
      body: new Uint8Array(raw),
    }).formData();
  } catch {
    return fail(400, 'form_expired', RELOAD);
  }

  // Every key must be known and text fields appear once.
  const fields: Record<string, unknown> = {};
  let website = '';
  let formToken = '';
  const files: File[] = [];
  for (const [key, value] of form.entries()) {
    if (key === 'files') {
      if (typeof value !== 'string' && value.size > 0) files.push(value);
      continue;
    }
    if (typeof value !== 'string') return fail(400, 'form_expired', RELOAD);
    if (key === 'website') website = value;
    else if (key === 'formToken') formToken = value;
    else if (TEXT_FIELDS.has(key) && !(key in fields)) fields[key] = value;
    else return fail(400, 'form_expired', RELOAD);
  }
  // An empty optional field arrives as "" and is left out, so "no deadline" and "no field" are the same thing.
  if (typeof fields.quantity === 'string') {
    fields.quantity = /^\d{1,5}$/.test(fields.quantity.trim())
      ? Number(fields.quantity)
      : fields.quantity;
  }

  // The hidden field no person sees. A robot fills it in; it is told everything went well and nothing is sent anywhere.
  if (website.trim() !== '') return { status: 200, body: { ok: true, ref: fakeRef() } };

  const validation = validateQuoteRequest(fields);
  if (!validation.ok) {
    if (validation.issues.some((i) => i.code === 'unknown_field' || i.code === 'invalid_type')) {
      return fail(400, 'form_expired', RELOAD);
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
  const value = validation.value;
  const late = deadlineProblem(value.deadline, todayInShop(new Date(now)));
  if (late) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'invalid',
        errors: [
          {
            field: 'deadline',
            message:
              late === 'past'
                ? 'The date has already passed. Choose a later one.'
                : 'Choose a date within the next two years.',
          },
        ],
      },
    };
  }

  const prepared = await prepareUploads(files);
  if (!prepared.ok) {
    return {
      status: 400,
      body: {
        ok: false,
        code: 'invalid',
        errors: [{ field: 'files', message: prepared.problem.message }],
      },
    };
  }

  const token = checkQuoteFormToken(config.secret, formToken, now);
  if (token === 'invalid' || token === 'expired') {
    return fail(
      400,
      'form_expired',
      'This form has expired. Please reload the page and send it again.',
    );
  }
  if (token === 'too_fast') {
    return fail(429, 'try_again', 'That was quick! Please check your request and send it again.');
  }

  const hashed = clientKey(config.secret, clientAddress(request.headers));
  const own = deps.perClient.hit(hashed);
  const all = deps.overall.hit('all');
  if (!own.allowed || !all.allowed) {
    const retry = Math.max(
      own.allowed ? 0 : own.retryAfterSeconds,
      all.allowed ? 0 : all.retryAfterSeconds,
    );
    return fail(429, 'rate_limited', 'Too many requests were sent. Please try again later.', {
      'Retry-After': String(retry),
    });
  }

  const answer = await callQuotesPlugin(
    config,
    '/kcpw-quotes/v1/requests',
    { request: value, files: prepared.files, clientKey: hashed },
    deps.fetchImpl,
  );
  if (!answer.reached) {
    deps.log?.(`[quotes] request not saved: ${answer.why}`);
    return fail(503, 'unavailable', UNAVAILABLE);
  }
  const json = (answer.json ?? {}) as { ok?: unknown; status?: unknown; ref?: unknown };
  if (
    answer.status === 200 &&
    json.ok === true &&
    typeof json.ref === 'string' &&
    QUOTE_REF.test(json.ref)
  ) {
    return { status: 200, body: { ok: true, ref: json.ref } };
  }
  if (answer.status === 429) {
    return fail(429, 'rate_limited', 'Too many requests were sent. Please try again later.', {
      'Retry-After': '3600',
    });
  }
  if (answer.status === 400 && json.status === 'invalid_file') {
    return fail(
      400,
      'bad_file',
      'One of the pictures could not be used. Please try a different one (JPEG, PNG, WebP or GIF).',
    );
  }
  deps.log?.(
    `[quotes] request not saved: ${answer.status === 400 ? `the shop refused it (${String(json.status ?? 'no status')})` : whyUnavailable(answer.status)}`,
  );
  return fail(503, 'unavailable', UNAVAILABLE);
}
