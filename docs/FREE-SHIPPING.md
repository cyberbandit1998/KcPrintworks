# Free-shipping progress bar (cart)

Status: **built and tested in a browser against the placeholder catalog and the mock store; not yet checked against your real WooCommerce
shipping settings** (this sandbox cannot reach them). It never changes WooCommerce's shipping configuration and never touches checkout,
Stripe or the cart handoff.

The cart shows, directly above the order summary on desktop and at the top of the cart on phones:

- below the minimum: **"You're only $X.XX away from free shipping!"** and a bar filled in proportion;
- at or above it: **"You've unlocked FREE shipping!"** and a full bar;
- a one-line note: "Your final shipping is confirmed at checkout, after any discount code."

## It is a display, not a decision

WooCommerce applies its own shipping rules and charges the shipping. The storefront knows none of them, so the bar works from **one number
you set** (the minimum) and the items total from the same prices as the "Subtotal" line. Nothing in the code can see a shipping charge, so
your flat rate (`5.25 + 3.25 x (quantity - 1)`) can never leak into the progress: four $8.00 items are $32.00 of items, not $47.00.
A unit test and a browser test pin that.

## Settings (VPS `.env`; read on every request, so a change needs `docker compose up -d`, no rebuild)

| Variable | Meaning |
|---|---|
| `FREE_SHIPPING_THRESHOLD` | Dollars, e.g. `40` or `40.00`. **Empty or unset = `40.00`.** `off` (or `0`) hides the bar. A value that is not a dollar amount hides the bar and the server log says why (it never guesses). |
| `FREE_SHIPPING_BEFORE_DISCOUNTS` | `true` only if the WooCommerce Free Shipping method has **"Apply minimum order rule before coupon discount"** ticked. Default `false`, which is WooCommerce's default: discounts count against the minimum. |

**The number must match WooCommerce.** In WooCommerce > Settings > Shipping > the zone > Free shipping, the method should be set to
**"A minimum order amount"** with the same amount. This is a configuration you own: nothing here can read or change it. If they differ, the bar
and the checkout will disagree, so check it once with the staging test below.

## When it says nothing (so it never promises what it cannot know)

The bar is hidden, or shows a neutral "Checking..." line, and **no promise is made** when:

- prices have not loaded, or the price request failed;
- an item in the cart has a problem (out of stock, an unknown option);
- an amount is not whole cents, or a discount is in another currency than the items;
- a discount is on a quote that no longer matches the cart (it waits for the fresh one);
- `FREE_SHIPPING_THRESHOLD` is `off` or invalid.

## Quantity changes, removals, discounts

- Changing a quantity or removing a line updates the bar **at once**: the total is worked out from the unit prices of the last quote, then replaced
  by the authoritative subtotal when the fresh quote arrives.
- Discounts: the cart's own quote has none today (coupons are entered at WooCommerce's checkout, so the note says "after any discount code").
  The quote contract has an optional `discount` field and the bar already honors it, per the rule above, so it is ready if coupons ever come into the cart.

## What it assumes (unverified; part of the staging test)

1. The Free Shipping method is configured as a **minimum order amount** (not "a valid free shipping coupon", which cannot be shown as progress).
2. WooCommerce compares the **items subtotal**. If your store shows prices **including tax**, WooCommerce subtracts discount tax and the figures can
   differ slightly from the items total shown here.
3. Free shipping applies to the shopper's destination. The bar cannot know the address; if free shipping is limited to some zones, shoppers elsewhere
   will still see the bar. Say so and the wording can be changed.
4. Personalization charges (options that add money) count toward the items total, as they do in WooCommerce, because `kcpw-core` puts them in the cart line price.
   Not yet observed on a real store.

## Test it on staging (add to the checklist in [CHECKOUT-STAGING-CHECKLIST.md](CHECKOUT-STAGING-CHECKLIST.md), row N)

Use a real product. Build a cart just below, exactly at, and just above your minimum, press Checkout, and compare with the cart's message:

| Cart | Cart bar says | WooCommerce checkout should show |
|---|---|---|
| items total a few cents under the minimum | "You're only $0.0x away" | shipping from your flat rate |
| items total exactly the minimum | "You've unlocked FREE shipping!" | Free shipping |
| above the minimum | unlocked | Free shipping |
| above the minimum, then a coupon that takes it below | unlocked in the cart (the cart does not know the code) | shipping returns (if "before discount" is **not** ticked) |

Any mismatch means the minimum in `.env` differs from the WooCommerce setting or one of the assumptions above does not hold: tell me which row.
