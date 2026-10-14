import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { GET as checkoutStatus } from '@/app/api/checkout-status/route';
import { POST as handoff } from '@/app/api/cart/handoff/route';

describe('GET /api/health', () => {
  it('answers 200 with no caching and touches no upstream', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('checkout stays disabled until an operator turns it on', () => {
  // The default deployment sets none of CHECKOUT_ENABLED / KCPW_API_URL / KCPW_HANDOFF_SECRET. Turning checkout on is a
  // deliberate act (see lib/checkout.ts) and is impossible in a production build.
  it('reports itself off, and the handoff endpoint refuses', async () => {
    expect(await (await checkoutStatus()).json()).toMatchObject({ enabled: false });
    const response = await handoff(
      new Request('http://localhost/api/cart/handoff/', {
        method: 'POST',
        body: JSON.stringify({ lines: [{ productId: 1, quantity: 1 }] }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'checkout_disabled' });
  });
});
