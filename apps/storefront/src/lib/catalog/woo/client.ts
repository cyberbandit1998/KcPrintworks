import type { WooConfig } from './config';

/**
 * Read-only client for the WooCommerce REST API (v3). There is no method that sends anything but GET, credentials travel
 * in an Authorization header over https (never in the URL), redirects are refused so a credentialed request cannot be
 * forwarded to another host, and errors never include the key.
 */
export class WooError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'WooError';
  }
}

export interface WooClient {
  get(
    path: string,
    params?: Record<string, string | number>,
  ): Promise<{ data: unknown; totalPages: number }>;
  getAll(path: string, params?: Record<string, string | number>): Promise<unknown[]>;
}

const PER_PAGE = 100;
const TIMEOUT_MS = 15_000;

export function createWooClient(config: WooConfig, fetchImpl: typeof fetch = fetch): WooClient {
  const authorization = `Basic ${Buffer.from(`${config.key}:${config.secret}`).toString('base64')}`;

  async function get(path: string, params: Record<string, string | number> = {}) {
    const url = new URL(`/wp-json/wc/v3${path}`, config.baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: authorization, Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'network error';
      throw new WooError(`WooCommerce request failed (${reason})`);
    }
    if (!response.ok)
      throw new WooError(`WooCommerce returned HTTP ${response.status}`, response.status);
    try {
      return {
        data: (await response.json()) as unknown,
        totalPages: Number(response.headers.get('x-wp-totalpages') ?? 1) || 1,
      };
    } catch {
      throw new WooError('WooCommerce returned a response that is not JSON', response.status);
    }
  }

  async function getAll(path: string, params: Record<string, string | number> = {}) {
    const items: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const { data, totalPages } = await get(path, { ...params, per_page: PER_PAGE, page });
      if (!Array.isArray(data)) throw new WooError(`${path} did not return a list`);
      items.push(...data);
      if (data.length < PER_PAGE || page >= totalPages) return items;
    }
  }

  return { get, getAll };
}
