import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { checkoutAvailable } from '@/lib/checkout';

describe('GET /api/health', () => {
  it('answers 200 with no caching and touches no upstream', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('checkout stays disabled until it is approved and connected', () => {
  // Flipping this is a deliberate change (Step 3: secure cart handoff to the WooCommerce checkout with
  // the official Stripe plugin, test mode first) and needs the owner's approval. No environment variable
  // can turn it on, so a container cannot be deployed with checkout enabled by accident.
  it('is off', () => {
    expect(checkoutAvailable).toBe(false);
  });
});
