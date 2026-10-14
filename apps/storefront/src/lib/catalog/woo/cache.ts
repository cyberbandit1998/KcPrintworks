/**
 * A small in-process cache with stale-while-revalidate and explicit invalidation.
 *
 *  - Fresh (younger than `ttlMs`): returned as is.
 *  - Stale: the old value is returned at once and ONE background refresh starts (single flight), so shoppers never wait
 *    for WooCommerce and a slow or failing WooCommerce never makes the shop slow or empty.
 *  - invalidate(): marks the value stale; with `{ blocking: true }` the next get() waits for the fresh load (used by the
 *    revalidation webhook so "I saved a product" is visible on the very next page view).
 *  - A failed refresh keeps serving the last good value, records the error, and retries after `retryMs`.
 * Used with one container; several instances would each hold their own cache (still correct, just refreshed separately).
 */
export interface CacheStatus {
  hasValue: boolean;
  loadedAt: number | null;
  ageMs: number | null;
  ttlMs: number;
  stale: boolean;
  refreshing: boolean;
  lastError: string | null;
  lastErrorAt: number | null;
  lastLoadMs: number | null;
  loads: number;
  failures: number;
}

export class SwrCache<T> {
  private value: T | undefined;
  private loadedAt: number | null = null;
  private generation = 0; // bumped by invalidate(); a load only clears the invalidation it started after
  private loadedGeneration = -1;
  private blockingGeneration = -1;
  private inflight: Promise<T> | null = null;
  private inflightGeneration = -1;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private lastLoadMs: number | null = null;
  private loads = 0;
  private failures = 0;
  private retryAfter = 0;

  constructor(
    private readonly loader: () => Promise<T>,
    private readonly options: { ttlMs: number; retryMs?: number; now?: () => number } = {
      ttlMs: 120_000,
    },
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private isStale(): boolean {
    return (
      this.loadedAt === null ||
      this.loadedGeneration !== this.generation ||
      this.now() - this.loadedAt >= this.options.ttlMs
    );
  }

  async get(): Promise<T> {
    if (this.value === undefined) return this.refresh();
    if (this.blockingGeneration === this.generation && this.loadedGeneration !== this.generation) {
      return this.refresh();
    }
    if (this.isStale() && this.now() >= this.retryAfter) {
      void this.refresh().catch(() => undefined); // errors are recorded in status
    }
    return this.value;
  }

  invalidate(options: { blocking?: boolean } = {}): void {
    this.generation += 1;
    this.retryAfter = 0;
    if (options.blocking) this.blockingGeneration = this.generation;
  }

  private refresh(): Promise<T> {
    if (this.inflight) {
      // A load that began before the latest invalidation may hold old data: follow it with a fresh one.
      if (this.inflightGeneration === this.generation) return this.inflight;
      return this.inflight.then(
        () => this.refresh(),
        () => this.refresh(),
      );
    }
    const started = this.now();
    const generation = this.generation;
    this.inflightGeneration = generation;
    this.inflight = this.loader()
      .then((value) => {
        this.value = value;
        this.loadedAt = this.now();
        this.loadedGeneration = generation;
        this.lastError = null;
        this.lastLoadMs = this.now() - started;
        this.loads += 1;
        return value;
      })
      .catch((error: unknown) => {
        this.failures += 1;
        this.lastError = error instanceof Error ? error.message : 'unknown error';
        this.lastErrorAt = this.now();
        this.retryAfter = this.now() + (this.options.retryMs ?? 15_000);
        this.blockingGeneration = -1; // never block every request behind a failing upstream
        if (this.value !== undefined) return this.value;
        throw error;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  status(): CacheStatus {
    return {
      hasValue: this.value !== undefined,
      loadedAt: this.loadedAt,
      ageMs: this.loadedAt === null ? null : this.now() - this.loadedAt,
      ttlMs: this.options.ttlMs,
      stale: this.value !== undefined && this.isStale(),
      refreshing: this.inflight !== null,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastLoadMs: this.lastLoadMs,
      loads: this.loads,
      failures: this.failures,
    };
  }
}
