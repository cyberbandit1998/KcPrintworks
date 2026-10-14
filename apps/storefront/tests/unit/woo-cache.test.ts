import { describe, expect, it } from 'vitest';
import { SwrCache } from '@/lib/catalog/woo/cache';

function setup(options: { ttlMs?: number; retryMs?: number } = {}) {
  let clock = 1_000;
  let calls = 0;
  let version = 1;
  const gates: { resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
  const cache = new SwrCache<string>(
    () => {
      calls += 1;
      return new Promise<string>((resolve, reject) => gates.push({ resolve, reject }));
    },
    { ttlMs: options.ttlMs ?? 100, retryMs: options.retryMs ?? 50, now: () => clock },
  );
  const release = (value = `v${version++}`) => gates.shift()!.resolve(value);
  return {
    cache,
    release,
    fail: (message: string) => gates.shift()!.reject(new Error(message)),
    advance: (ms: number) => (clock += ms),
    calls: () => calls,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('SwrCache', () => {
  it('loads once, then serves from memory while fresh', async () => {
    const t = setup();
    const first = t.cache.get();
    t.release('a');
    expect(await first).toBe('a');
    expect(await t.cache.get()).toBe('a');
    expect(t.calls()).toBe(1);
  });

  it('shares one load between concurrent first requests', async () => {
    const t = setup();
    const both = Promise.all([t.cache.get(), t.cache.get(), t.cache.get()]);
    t.release('a');
    expect(await both).toEqual(['a', 'a', 'a']);
    expect(t.calls()).toBe(1);
  });

  it('serves the old copy at once when stale and refreshes once in the background', async () => {
    const t = setup();
    const first = t.cache.get();
    t.release('a');
    await first;
    t.advance(150);
    expect(await t.cache.get()).toBe('a'); // not blocked
    expect(await t.cache.get()).toBe('a');
    expect(t.calls()).toBe(2); // exactly one refresh in flight
    t.release('b');
    await settle();
    expect(await t.cache.get()).toBe('b');
  });

  it('keeps serving the last good copy when a refresh fails, records why, and retries later', async () => {
    const t = setup();
    const first = t.cache.get();
    t.release('a');
    await first;
    t.advance(150);
    await t.cache.get();
    t.fail('WooCommerce returned HTTP 503');
    await settle();
    expect(await t.cache.get()).toBe('a');
    expect(t.cache.status()).toMatchObject({
      lastError: 'WooCommerce returned HTTP 503',
      failures: 1,
      hasValue: true,
    });
    expect(t.calls()).toBe(2); // not retried before retryMs
    t.advance(60);
    await t.cache.get();
    expect(t.calls()).toBe(3);
  });

  it('fails the very first load loudly (there is nothing to serve)', async () => {
    const t = setup();
    const first = t.cache.get();
    t.fail('down');
    await expect(first).rejects.toThrow('down');
  });

  it('blocking invalidation makes the next read wait for fresh data', async () => {
    const t = setup({ ttlMs: 10_000 });
    const first = t.cache.get();
    t.release('a');
    await first;
    t.cache.invalidate({ blocking: true });
    const next = t.cache.get();
    expect(t.calls()).toBe(2);
    t.release('b');
    expect(await next).toBe('b');
  });

  it('plain invalidation serves the old copy while refreshing', async () => {
    const t = setup({ ttlMs: 10_000 });
    const first = t.cache.get();
    t.release('a');
    await first;
    t.cache.invalidate();
    expect(await t.cache.get()).toBe('a');
    t.release('b');
    await settle();
    expect(await t.cache.get()).toBe('b');
  });

  it('an invalidation that arrives during a load is not lost', async () => {
    const t = setup({ ttlMs: 10_000 });
    const first = t.cache.get();
    t.cache.invalidate({ blocking: true }); // the product was saved while the load was already running
    t.release('old');
    await first;
    expect(t.cache.status().stale).toBe(true);
    const next = t.cache.get(); // must start a NEW load, not reuse the old result
    await settle();
    t.release('new');
    expect(await next).toBe('new');
    expect(t.calls()).toBe(2);
  });

  it('does not block every request behind a failing upstream after an invalidation', async () => {
    const t = setup({ ttlMs: 10_000 });
    const first = t.cache.get();
    t.release('a');
    await first;
    t.cache.invalidate({ blocking: true });
    const next = t.cache.get();
    t.fail('down');
    expect(await next).toBe('a'); // last good copy
    expect(await t.cache.get()).toBe('a'); // and it does not wait again
    expect(t.calls()).toBe(2);
  });
});
