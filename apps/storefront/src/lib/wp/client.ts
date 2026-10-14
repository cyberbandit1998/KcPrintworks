import type { WpConfig } from './config';

/**
 * Read-only client for the WordPress REST API (wp/v2), for PUBLISHED content only. There is no method that sends anything but GET,
 * no credential is sent, redirects are refused, a request times out, and a response is size-limited and must be JSON.
 */
export class WpError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'WpError';
  }
}

export interface WpResult {
  data: unknown;
  total: number;
  totalPages: number;
}

export interface WpClient {
  get(path: string, params?: Record<string, string | number>): Promise<WpResult>;
}

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 6_000_000;

export function createWpClient(
  config: Pick<WpConfig, 'baseUrl'>,
  fetchImpl: typeof fetch = fetch,
  /** The REST namespace: WordPress content (wp/v2) by default; WooCommerce's public Store API for reviews. */
  prefix = '/wp-json/wp/v2',
): WpClient {
  async function get(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<WpResult> {
    const url = new URL(`${prefix}${path}`, config.baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new WpError(
        `WordPress request failed (${error instanceof Error ? error.name : 'network error'})`,
      );
    }
    if (!response.ok)
      throw new WpError(`WordPress returned HTTP ${response.status}`, response.status);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new WpError('WordPress response is too large', response.status);
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new WpError('WordPress response could not be read', response.status);
    }
    if (text.length > MAX_BYTES)
      throw new WpError('WordPress response is too large', response.status);
    try {
      return {
        data: JSON.parse(text) as unknown,
        total: Number(response.headers.get('x-wp-total') ?? 0) || 0,
        totalPages: Number(response.headers.get('x-wp-totalpages') ?? 1) || 1,
      };
    } catch {
      throw new WpError('WordPress returned a response that is not JSON', response.status);
    }
  }
  return { get };
}
