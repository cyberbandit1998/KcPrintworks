import { signedHeaders } from '../handoff/sign';
import type { QuotesConfig } from './config';

/**
 * One signed server-to-server call to the kcpw-quotes plugin on the shop host. The browser never sees this address, the secret or the
 * raw answer. `route` is the REST route without /wp-json, exactly what the plugin signs against.
 */
const TIMEOUT_MS = 20_000;

export type UpstreamAnswer =
  { reached: true; status: number; json: unknown } | { reached: false; why: string };

export async function callQuotesPlugin(
  config: QuotesConfig,
  route: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamAnswer> {
  const body = JSON.stringify(payload);
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
      reached: false,
      why: `request failed (${error instanceof Error ? error.name : 'error'})`,
    };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    return { reached: false, why: `HTTP ${response.status} without JSON` };
  }
  return { reached: true, status: response.status, json };
}

/** Why a call that did not work did not work, in words for the operator's log (never for the visitor). */
export function whyUnavailable(status: number): string {
  if (status === 401) return 'the shop did not accept the signature (check KCPW_HANDOFF_SECRET)';
  if (status === 503)
    return 'the shop says the link is not set up (KCPW_HANDOFF_SECRET in wp-config.php)';
  if (status === 404)
    return 'the shop does not have the quotes routes (install and activate kcpw-quotes)';
  return `HTTP ${status}`;
}
