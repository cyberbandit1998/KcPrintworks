import { describe, expect, it } from 'vitest';
import { money } from '@kcpw/contracts/client';
import {
  FREE_SHIPPING_UNLOCKED,
  estimateItemsSubtotal,
  freeShippingProgress,
  type FreeShippingRule,
} from '@/lib/free-shipping';

const rule: FreeShippingRule = { thresholdMinor: 4000, ignoreDiscounts: false };
// A raw amount, not money(): the helper refuses non-integers, and the logic must refuse them too if one ever arrives.
const at = (subtotal: number, extra: Record<string, unknown> = {}) =>
  freeShippingProgress({
    rule,
    subtotal: { amount: subtotal, currency: 'USD' },
    reliable: true,
    ...extra,
  });

/** The shop's flat rate: 5.25 + 3.25 x (quantity - 1), in cents. It is NEVER part of the progress. */
const flatRate = (quantity: number) => 525 + 325 * (quantity - 1);

describe('below, at, and above the threshold', () => {
  it('says how far away the shopper is, to the cent, and does not promise', () => {
    expect(at(3200)).toMatchObject({
      unlocked: false,
      percent: 80,
      remaining: { amount: 800, currency: 'USD' },
      message: "You're only $8.00 away from free shipping!",
    });
    expect(at(800)?.message).toBe("You're only $32.00 away from free shipping!");
    expect(at(0)).toMatchObject({ unlocked: false, percent: 0 });
    expect(at(0)?.message).toBe("You're only $40.00 away from free shipping!");
  });

  it('is one cent short at $39.99: not unlocked, and the bar is not shown as full', () => {
    const status = at(3999);
    expect(status).toMatchObject({ unlocked: false, remaining: { amount: 1 } });
    expect(status?.message).toBe("You're only $0.01 away from free shipping!");
    expect(status?.percent).toBe(99); // 99.975 percent must never round up to a full bar
  });

  it('unlocks at exactly $40.00', () => {
    const status = at(4000);
    expect(status).toMatchObject({ unlocked: true, percent: 100, remaining: { amount: 0 } });
    expect(status?.message).toBe("You've unlocked FREE shipping!");
    expect(status?.message).toBe(FREE_SHIPPING_UNLOCKED);
  });

  it('stays unlocked, and the bar stays at 100%, above the threshold', () => {
    for (const subtotal of [4001, 4500, 12000, 999_999]) {
      expect(at(subtotal), String(subtotal)).toMatchObject({
        unlocked: true,
        percent: 100,
        message: "You've unlocked FREE shipping!",
      });
    }
  });

  it('fills from 0% to 100% in step with the subtotal', () => {
    const percents = [0, 400, 800, 1600, 2000, 3200, 3600, 3960, 3999, 4000].map(
      (subtotal) => at(subtotal)!.percent,
    );
    expect(percents).toEqual([0, 10, 20, 40, 50, 80, 90, 99, 99, 100]);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents); // never goes backwards as the cart grows
  });

  it('uses the threshold it is given', () => {
    const cheap: FreeShippingRule = { thresholdMinor: 2500, ignoreDiscounts: false };
    const status = freeShippingProgress({
      rule: cheap,
      subtotal: money(2499),
      reliable: true,
    });
    expect(status?.message).toBe("You're only $0.01 away from free shipping!");
    expect(
      freeShippingProgress({ rule: cheap, subtotal: money(2500), reliable: true })?.unlocked,
    ).toBe(true);
  });
});

describe('quantity changes', () => {
  // A $8.00 item: the status follows the quantity, step by step.
  const unit = 800;
  const byQuantity = (quantity: number) => at(unit * quantity)!;

  it('moves toward the goal as quantity goes up and back as it comes down', () => {
    expect(byQuantity(1).message).toBe("You're only $32.00 away from free shipping!");
    expect(byQuantity(2).message).toBe("You're only $24.00 away from free shipping!");
    expect(byQuantity(4).message).toBe("You're only $8.00 away from free shipping!");
    expect(byQuantity(5).message).toBe("You've unlocked FREE shipping!");
    expect(byQuantity(6).unlocked).toBe(true);
    expect(byQuantity(4).unlocked).toBe(false); // back down: the promise is withdrawn
  });

  it('never counts the shipping charge, whatever the quantity', () => {
    for (let quantity = 1; quantity <= 10; quantity++) {
      const items = unit * quantity;
      const status = at(items)!;
      expect(status.unlocked, `quantity ${quantity}`).toBe(items >= 4000);
      expect(status.remaining.amount).toBe(Math.max(0, 4000 - items));
    }
    // The trap this guards against: at quantity 4 the items are $32.00, but items + flat-rate shipping is $47.00.
    // Counting shipping would wrongly unlock free shipping.
    expect(unit * 4 + flatRate(4)).toBeGreaterThanOrEqual(4000);
    expect(byQuantity(4).unlocked).toBe(false);
  });
});

describe('discounts and the shop’s minimum-order rule', () => {
  it('by default a discount counts against the minimum (WooCommerce’s default)', () => {
    const status = at(4500, { discount: money(1000) });
    expect(status).toMatchObject({
      unlocked: false,
      remaining: { amount: 500 },
      message: "You're only $5.00 away from free shipping!",
    });
    expect(status?.percent).toBe(87);
  });

  it('sits on the boundary correctly once the discount is taken off', () => {
    expect(at(5000, { discount: money(1000) })?.unlocked).toBe(true); // exactly $40.00 left
    expect(at(5000, { discount: money(1001) })).toMatchObject({
      unlocked: false,
      remaining: { amount: 1 },
    });
  });

  it('a discount larger than the items cannot make the amount negative', () => {
    expect(at(1000, { discount: money(5000) })).toMatchObject({
      unlocked: false,
      percent: 0,
      remaining: { amount: 4000 },
    });
  });

  it('when the shop applies the minimum before discounts, they are ignored', () => {
    const before: FreeShippingRule = { thresholdMinor: 4000, ignoreDiscounts: true };
    const status = freeShippingProgress({
      rule: before,
      subtotal: money(4500),
      discount: money(1000),
      reliable: true,
    });
    expect(status).toMatchObject({ unlocked: true, percent: 100 });
  });

  it('no discount is the same as a zero discount', () => {
    expect(at(3000)).toEqual(at(3000, { discount: money(0) }));
  });
});

describe('when eligibility cannot be determined, nothing is promised and nothing is shown', () => {
  it('needs a reliable cart (prices not loaded, request failed, an item with a problem)', () => {
    expect(freeShippingProgress({ rule, subtotal: money(9999), reliable: false })).toBeNull();
  });

  it('refuses amounts that are not whole, non-negative cents', () => {
    for (const amount of [Number.NaN, -1, 12.5, Number.POSITIVE_INFINITY]) {
      expect(at(amount), String(amount)).toBeNull();
    }
    expect(at(4000, { discount: { amount: -5, currency: 'USD' } })).toBeNull();
    expect(at(4000, { discount: { amount: 0.5, currency: 'USD' } })).toBeNull();
  });

  it('refuses a discount in another currency than the items', () => {
    expect(at(4000, { discount: money(100, 'EUR') })).toBeNull();
  });

  it('refuses a rule that is not a positive whole number of cents', () => {
    for (const thresholdMinor of [0, -4000, 40.5, Number.NaN]) {
      expect(
        freeShippingProgress({
          rule: { thresholdMinor, ignoreDiscounts: false },
          subtotal: money(5000),
          reliable: true,
        }),
        String(thresholdMinor),
      ).toBeNull();
    }
  });

  it('shows no rule at all when the shop has not set one', () => {
    expect(freeShippingProgress({ rule: null, subtotal: money(5000), reliable: true })).toBeNull();
  });
});

describe('estimating the items total while a new quote is on its way', () => {
  const priced = [
    { key: 'a', unitPrice: money(800), issues: [] },
    { key: 'b', unitPrice: money(2200), issues: [] },
  ];

  it('follows the quantities at once, from the unit prices already known', () => {
    expect(estimateItemsSubtotal([{ key: 'a', quantity: 4 }], priced)).toEqual(money(3200));
    expect(estimateItemsSubtotal([{ key: 'a', quantity: 5 }], priced)).toEqual(money(4000));
    expect(
      estimateItemsSubtotal(
        [
          { key: 'a', quantity: 1 },
          { key: 'b', quantity: 2 },
        ],
        priced,
      ),
    ).toEqual(money(5200));
  });

  it('says nothing when a line has no price on file, has a problem, or the quantity is not a whole number', () => {
    expect(estimateItemsSubtotal([{ key: 'new', quantity: 1 }], priced)).toBeNull();
    expect(
      estimateItemsSubtotal(
        [{ key: 'a', quantity: 1 }],
        [{ key: 'a', unitPrice: money(800), issues: [{ code: 'out_of_stock' }] }],
      ),
    ).toBeNull();
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(estimateItemsSubtotal([{ key: 'a', quantity }], priced), String(quantity)).toBeNull();
    }
    expect(estimateItemsSubtotal([], priced)).toBeNull();
  });

  it('refuses to mix currencies', () => {
    expect(
      estimateItemsSubtotal(
        [
          { key: 'a', quantity: 1 },
          { key: 'e', quantity: 1 },
        ],
        [...priced, { key: 'e', unitPrice: money(500, 'EUR'), issues: [] }],
      ),
    ).toBeNull();
  });
});
