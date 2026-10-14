import { z } from 'zod';
import type { CheckoutConfig } from '../checkout';
import { signedHeaders } from './sign';

/**
 * Talks to kcpw-core on the shop host, server to server. The browser never sees this address, the secret, or the raw
 * answer. Every answer is validated, and the checkout URL it returns is checked to be the shop host's own single-use
 * link before the shopper is sent there.
 */
const TIMEOUT_MS = 15_000;
const TOKEN_LINK = /^[A-Za-z0-9_-]{43}$/;

const IssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
});

const LineSchema = z.object({
  index: z.number().int().nonnegative(),
  issues: z.array(IssueSchema),
});

const SuccessSchema = z.object({
  ok: z.literal(true),
  subtotal: z.number().int().nonnegative(),
  redirectUrl: z.string(),
});

const FailureSchema = z.object({
  ok: z.literal(false),
  status: z.string(),
  subtotal: z.number().int().nonnegative().optional(),
  lines: z.array(LineSchema).optional(),
});

export type UpstreamResult =
  | { kind: 'ok'; redirectUrl: string }
  | {
      kind: 'invalid_lines';
      lines: { index: number; issues: { code: string; message: string; field?: string }[] }[];
    }
  | { kind: 'changed'; subtotal?: number }
  | { kind: 'invalid_request' }
  | { kind: 'unavailable'; why: string };

/** The shop host's link must be its own front page with exactly one query value, a 43-character token. */
export function acceptableRedirect(candidate: string, apiUrl: string): string | undefined {
  try {
    const url = new URL(candidate);
    const base = new URL(apiUrl);
    if (url.origin !== base.origin || url.username || url.password || url.hash) return undefined;
    if (url.pathname !== '/' && url.pathname !== '') return undefined;
    const params = [...url.searchParams.entries()];
    if (
      params.length !== 1 ||
      params[0]![0] !== 'kcpw_handoff' ||
      !TOKEN_LINK.test(params[0]![1])
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function requestHandoff(
  config: CheckoutConfig,
  lines: unknown[],
  expectedSubtotal: number,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamResult> {
  const route = '/kcpw/v1/cart/handoff';
  const body = JSON.stringify({ lines, expectedSubtotal });
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
      kind: 'unavailable',
      why: `request failed (${error instanceof Error ? error.name : 'error'})`,
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { kind: 'unavailable', why: `HTTP ${response.status} without JSON` };
  }

  if (response.status === 200) {
    const parsed = SuccessSchema.safeParse(json);
    const redirect = parsed.success
      ? acceptableRedirect(parsed.data.redirectUrl, config.apiUrl)
      : undefined;
    return redirect
      ? { kind: 'ok', redirectUrl: redirect }
      : { kind: 'unavailable', why: 'unexpected success answer' };
  }
  if (response.status === 401 || response.status === 403)
    return {
      kind: 'unavailable',
      why: 'the shop did not accept the signature (check KCPW_HANDOFF_SECRET)',
    };
  if (response.status === 503)
    return { kind: 'unavailable', why: 'the shop says the checkout link is not set up' };
  const failure = FailureSchema.safeParse(json);
  if (response.status === 422 && failure.success && failure.data.lines)
    return { kind: 'invalid_lines', lines: failure.data.lines };
  if (response.status === 409)
    return { kind: 'changed', subtotal: failure.success ? failure.data.subtotal : undefined };
  if (response.status === 400) return { kind: 'invalid_request' };
  return { kind: 'unavailable', why: `HTTP ${response.status}` };
}

const StatusSchema = z.object({
  ok: z.literal(true),
  plugin: z.string(),
  woocommerce: z.string().nullable(),
  currency: z.string().nullable(),
  storefrontUrlConfigured: z.boolean(),
  stripeActive: z.boolean(),
  stripeTestMode: z.boolean().nullable(),
  /** Where the shop sends a shopper back after a problem (KCPW_STOREFRONT_URL). Plugin 0.2.1 and later; older ones omit it. */
  storefrontUrl: z.string().nullable().optional(),
});
export type ShopStatus = z.infer<typeof StatusSchema>;

/** For the operator's status page: can this container reach the plugin, and does it accept our signature? */
export async function requestShopStatus(
  config: CheckoutConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ reachable: true; status: ShopStatus } | { reachable: false; why: string }> {
  const route = '/kcpw/v1/status';
  try {
    const response = await fetchImpl(new URL(`/wp-json${route}`, config.apiUrl), {
      method: 'GET',
      headers: { accept: 'application/json', ...signedHeaders(config.secret, 'GET', route, '') },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401)
      return {
        reachable: false,
        why: 'the shop did not accept the signature (check KCPW_HANDOFF_SECRET)',
      };
    if (response.status === 503)
      return {
        reachable: false,
        why: 'the plugin is installed but KCPW_HANDOFF_SECRET is not set in wp-config.php',
      };
    if (response.status === 404)
      return { reachable: false, why: 'the plugin is not active on that site (route not found)' };
    if (!response.ok) return { reachable: false, why: `HTTP ${response.status}` };
    const parsed = StatusSchema.safeParse(await response.json());
    return parsed.success
      ? { reachable: true, status: parsed.data }
      : { reachable: false, why: 'unexpected answer' };
  } catch (error) {
    return {
      reachable: false,
      why: `request failed (${error instanceof Error ? error.name : 'error'})`,
    };
  }
}
