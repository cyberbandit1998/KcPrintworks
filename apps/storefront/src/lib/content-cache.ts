import { SwrCache, type CacheStatus } from './catalog/woo/cache';

/**
 * Many small cached answers (a page of blog posts, one post, one page, one product's reviews), each with the same
 * stale-while-revalidate behavior as the catalog: a visitor is answered from memory, a stale answer is refreshed once in the
 * background, a failing upstream keeps serving the last good copy, and `invalidateAll({ blocking: true })` (the signed refresh)
 * makes the very next view wait for fresh data.
 *
 * The number of remembered answers is capped (oldest first out) so a crawler walking many page numbers cannot grow memory.
 */
export class KeyedSwrCache {
  private readonly entries = new Map<string, SwrCache<unknown>>();
  /** When "refresh now" last happened: a failure remembered from before it is forgotten, so the very next view tries again. */
  private clearedAt = -1;

  constructor(
    private readonly options: { ttlMs: number; maxEntries?: number; retryMs?: number },
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string, loader: () => Promise<T>): Promise<T> {
    let entry = this.entries.get(key) as SwrCache<T> | undefined;
    if (!entry) {
      entry = new SwrCache<T>(loader, {
        ttlMs: this.options.ttlMs,
        retryMs: this.options.retryMs,
        now: this.now,
      });
      this.entries.set(key, entry as SwrCache<unknown>);
      const max = this.options.maxEntries ?? 200;
      while (this.entries.size > max) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
    }
    // With nothing cached and a recent failure, answer with that failure at once: every visitor must not wait out
    // the timeout while WordPress is down. The cache itself retries after `retryMs`.
    const state = entry.status();
    const retryMs = this.options.retryMs ?? 15_000;
    if (
      !state.hasValue &&
      state.lastError &&
      state.lastErrorAt !== null &&
      state.lastErrorAt > this.clearedAt &&
      this.now() - state.lastErrorAt < retryMs
    ) {
      return Promise.reject(new Error(state.lastError));
    }
    return entry.get();
  }

  invalidateAll(options: { blocking?: boolean } = {}): void {
    this.clearedAt = this.now();
    for (const entry of this.entries.values()) entry.invalidate(options);
  }

  size(): number {
    return this.entries.size;
  }

  status(): { entries: number; failing: number; lastError: string | null } {
    let failing = 0;
    let lastError: string | null = null;
    for (const entry of this.entries.values()) {
      const s: CacheStatus = entry.status();
      if (s.lastError) {
        failing += 1;
        lastError = s.lastError;
      }
    }
    return { entries: this.entries.size, failing, lastError };
  }
}

/**
 * Everything that must be refreshed together when WooCommerce or WordPress says "something changed". The signed
 * /api/revalidate/ request calls this; the catalog registers nothing here because it has its own service.
 */
const REGISTRY_KEY = Symbol.for('kcpw.contentCaches');
type WithRegistry = typeof globalThis & { [REGISTRY_KEY]?: Set<KeyedSwrCache> };

export function registerContentCache(cache: KeyedSwrCache): void {
  const holder = globalThis as WithRegistry;
  (holder[REGISTRY_KEY] ??= new Set()).add(cache);
}

export function invalidateContentCaches(options: { blocking?: boolean } = {}): number {
  const caches = (globalThis as WithRegistry)[REGISTRY_KEY];
  if (!caches) return 0;
  for (const cache of caches) cache.invalidateAll(options);
  return caches.size;
}
