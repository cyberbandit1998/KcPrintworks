import { afterEach, describe, expect, it, vi } from 'vitest';

/** GET /api/search/ answers the header panel from the catalog held in memory (the fixture catalog here), small and limited. */
describe('GET /api/search/', () => {
  afterEach(() => {
    vi.resetModules();
  });

  const call = async (query: string, headers: Record<string, string> = {}) => {
    const { GET } = await import('@/app/api/search/route');
    const response = await GET(
      new Request(`https://kcprintworks.com/api/search/${query}`, { headers }),
    );
    return { response, body: await response.json() };
  };

  it('returns small rows for a match and says how many there are in all', async () => {
    const { response, body } = await call('?q=sample&limit=2');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.hits).toHaveLength(2);
    for (const hit of body.hits) {
      expect(Object.keys(hit).sort()).toEqual(
        expect.arrayContaining(['category', 'from', 'id', 'name', 'price', 'slug']),
      );
      expect(typeof hit.price.amount).toBe('number');
    }
    // Nothing a visitor cannot already see: no description, no SKU, no option schema.
    expect(JSON.stringify(body)).not.toMatch(/descriptionHtml|optionSchema|sku/);
  });

  it('finds a product with a typo and by a partial word', async () => {
    expect((await call('?q=stickr')).body.total).toBeGreaterThan(0);
    expect((await call('?q=tot')).body.hits.map((h: { name: string }) => h.name)).toContain(
      'Sample Tote Bag',
    );
  });

  it('returns an empty list, never an error, for a query that is too short, empty or matches nothing', async () => {
    for (const q of ['?q=', '?q=a', '', '?q=zzzzzzqqq']) {
      const { response, body } = await call(q);
      expect(response.status).toBe(200);
      expect(body.hits).toEqual([]);
    }
  });

  it('caps the number of rows and cleans a hostile query', async () => {
    expect((await call('?q=sample&limit=500')).body.hits.length).toBeLessThanOrEqual(8);
    const hostile = await call(
      `?q=${encodeURIComponent('<script>alert(1)</script>' + 'x'.repeat(300))}`,
    );
    expect(hostile.response.status).toBe(200);
    expect(hostile.body.query.length).toBeLessThanOrEqual(80);
  });

  it('is limited per visitor and says when to come back', async () => {
    const same = { 'x-real-ip': '198.51.100.9' };
    let last = await call('?q=sample', same);
    for (let i = 0; i < 125 && last.response.status === 200; i += 1) {
      last = await call('?q=sample', same);
    }
    expect(last.response.status).toBe(429);
    expect(Number(last.response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call('?q=sample', { 'x-real-ip': '198.51.100.10' })).response.status).toBe(200);
  });
});
