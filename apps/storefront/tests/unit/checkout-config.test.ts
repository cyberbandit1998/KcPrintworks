import { describe, expect, it } from 'vitest';
import { readCheckoutStatus } from '@/lib/checkout';

const SECRET = 'x'.repeat(40);
const on = {
  CHECKOUT_ENABLED: 'true',
  KCPW_API_URL: 'https://shop.example.com',
  KCPW_HANDOFF_SECRET: SECRET,
};

describe('checkout is off unless an operator deliberately turns it on', () => {
  it('is off by default, whatever else is set', () => {
    expect(readCheckoutStatus({}, false)).toMatchObject({ enabled: false });
    expect(readCheckoutStatus({ ...on, CHECKOUT_ENABLED: undefined }, false).enabled).toBe(false);
    for (const value of ['', 'false', '1', 'yes', 'TRUE', 'True']) {
      expect(readCheckoutStatus({ ...on, CHECKOUT_ENABLED: value }, false).enabled, value).toBe(
        false,
      );
    }
  });

  it('can never be on in a production build', () => {
    const status = readCheckoutStatus(on, true);
    expect(status).toEqual({ enabled: false, reason: 'not available in a production build' });
  });

  it('needs the shop address (https) and a long secret, and names what is missing without echoing values', () => {
    expect(readCheckoutStatus({ CHECKOUT_ENABLED: 'true' }, false)).toMatchObject({
      enabled: false,
      missing: ['KCPW_API_URL', 'KCPW_HANDOFF_SECRET (32 or more characters)'],
    });
    const short = readCheckoutStatus({ ...on, KCPW_HANDOFF_SECRET: 'short-secret-value' }, false);
    expect(short.enabled).toBe(false);
    expect(JSON.stringify(short)).not.toContain('short-secret-value');
    expect(
      readCheckoutStatus({ ...on, KCPW_API_URL: 'http://shop.example.com' }, false),
    ).toMatchObject({
      enabled: false,
      missing: ['KCPW_API_URL (must be https)'],
    });
    expect(readCheckoutStatus({ ...on, KCPW_API_URL: 'not a url' }, false).enabled).toBe(false);
  });

  it('is on when everything is set (plain http only for this machine)', () => {
    const status = readCheckoutStatus(
      { ...on, KCPW_API_URL: 'https://shop.example.com/some/path?x=1' },
      false,
    );
    expect(status).toEqual({
      enabled: true,
      config: { apiUrl: 'https://shop.example.com', secret: SECRET },
    });
    expect(
      readCheckoutStatus({ ...on, KCPW_API_URL: 'http://127.0.0.1:3200' }, false).enabled,
    ).toBe(true);
    expect(
      readCheckoutStatus({ ...on, KCPW_API_URL: 'http://localhost:8080' }, false).enabled,
    ).toBe(true);
  });
});
