# KCPrintWorks Checkout Style

Version 0.1.0. A small WordPress plugin for the shop site (`shop.kcprintworks.com`) that makes the **WooCommerce checkout page** look like the
KCPrintWorks storefront. It is styling only, and it does these things, on the checkout page and nowhere else:

1. Prints a **compact KCPrintWorks header** (the storefront's "KC" mark and name, a "Secure checkout" label, and one link back to the storefront's cart)
   and hides the theme's own tall header, its mobile menu, the breadcrumb bar and WooCommerce's store-wide notice (where an old "free shipping" banner usually lives).
2. Loads **one stylesheet** (`assets/checkout.css`, about 14 KB before compression) that gives the Checkout Block the storefront's colors, system-font type,
   2px ink borders, orange buttons with dark text, order-summary card and footer.
3. Hides WooCommerce's own "Return to Cart" link, because the header's link goes to the storefront's cart (WooCommerce's cart page is not part of the journey).

It does **not** load any script, font or image, call any other site, add a route, or touch the cart, the checkout fields, Stripe, PayPal, shipping, tax, orders
or personalization data. A test fails if the plugin's code ever contains such a call. It does not depend on `kcpw-core` and does not change its handoff.

Full instructions (install, preview first, rollback, what is verified and what is not): [docs/CHECKOUT-STYLE.md](../../docs/CHECKOUT-STYLE.md).

## Settings (optional, in `wp-config.php`)

| Constant | Meaning |
|---|---|
| `KCPW_CHECKOUT_STYLE` | `'on'` (default), `'admins'` (only logged-in administrators see the new look: a safe preview), or `'off'` (switch it off without deactivating). Anything else is treated as `'off'` |
| `KCPW_CHECKOUT_STYLE_PAGE_ID` | The checkout page's ID. Default `9` |
| `KCPW_CHECKOUT_STYLE_HIDE` | Extra elements to hide on the checkout page, e.g. `'.promo-bar, #free-ship-banner'`. Only plain class/id selectors; anything naming the checkout, a field, a button or a payment method is refused |
| `KCPW_STOREFRONT_URL` | Already set for `kcpw-core`. Where the header's logo and "Back to cart" go. Without it they stay on the shop |

## Development

```bash
php wordpress/kcpw-checkout-style/tests/run.php          # PHP tests, no dependencies
node --test scripts/checkout-style/checkout-style.test.mjs   # stylesheet rules: scoping, payment safety, tokens, contrast
npm run build:checkout-style                               # dist/kcpw-checkout-style.zip
php wordpress/kcpw-checkout-style/tests/fixture/build.php   # regenerate the rendering fixture after changing the header
```

`apps/storefront/tests/e2e/checkout-style.spec.ts` renders `tests/fixture/checkout.html` (a hand-written **stand-in** for the Astra page and the Checkout Block,
not the real ones) at 1280, 768, 375 and 320 px with an accessibility scan, and proves the stylesheet changes none of the payment area's geometry.
