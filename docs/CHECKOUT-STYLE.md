# Checkout style: make the WooCommerce checkout look like the storefront (owner runbook)

Status: **built and tested against a stand-in page only.** The sandbox cannot reach your WordPress, Astra, WooCommerce, Stripe or PayPal, so nobody (including me) has seen
the real checkout page with this plugin. Step 2 below ("Preview first") is how you check it, safely, before any customer does. Nothing in this document has been done to
your VPS or WordPress; every step is yours, and none of it changes DNS, Stripe, environment variables or `kcpw-core`.

Decision record: [ADR-019](DECISIONS.md). The plugin: [`wordpress/kcpw-checkout-style`](../wordpress/kcpw-checkout-style/README.md).

## What changes on `https://shop.kcprintworks.com/checkout/` (page ID 9), and what does not

| Changes (only on that page)                                                                                                               | Does not change                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Astra's tall header, mobile menu and breadcrumb bar are hidden; a **compact KCPrintWorks header** replaces them                           | Stripe and PayPal (their elements, scripts, settings, keys, mode)                                    |
| The header has the storefront's "KC" mark and name (drawn in HTML/CSS exactly like `kcprintworks.com`'s header, so no image to load), "Secure checkout", and one **Back to cart** link to the storefront | Shipping calculation, taxes, coupons                                                                 |
| WooCommerce's store-wide notice (the usual home of an old blue "free shipping" banner) is not printed on this page                        | Checkout fields, validation, order creation, emails                                                  |
| Colors, type, buttons, fields, notices, order-summary card and footer follow the storefront's design tokens (cream, ink, orange, blue)    | Personalization lines: they are shown in full in the order summary (long text wraps)                 |
| WooCommerce's own "Return to Cart" link is hidden, because the header's link goes to the storefront's cart                                | `kcpw-core` and the signed cart handoff; payment methods (none are disabled); the Astra logo setting  |

The old WordPress logo (`wp-content/uploads/2026/05/kcprintworks-logo.jpg`, attachment 313) is **not used** on the checkout any more. It is not deleted or replaced: it
is still Astra's logo for the rest of the shop site and its emails. The storefront has no logo image to copy: its logo is a "KC" square plus the words "KCPrintWorks" drawn in
HTML and CSS, and the plugin draws the same thing.

## 1. The file to install

**One plugin, six files**, as a single zip, `kcpw-checkout-style.zip`:

```
kcpw-checkout-style/kcpw-checkout-style.php      the plugin (header, settings, boot)
kcpw-checkout-style/src/Settings.php             reads and validates the optional wp-config.php settings
kcpw-checkout-style/src/HeaderMarkup.php         the compact header's HTML
kcpw-checkout-style/src/Plugin.php               the only WordPress-facing code (adds hooks on the checkout page only)
kcpw-checkout-style/assets/checkout.css          the stylesheet (about 14 KB, about 3 KB compressed)
kcpw-checkout-style/README.md
```

Where to get the zip (pick one):

- **GitHub:** _Actions > CI >_ the latest green run on branch `claude/hopeful-hamilton-lq8pw6` _> Artifacts > `kcpw-checkout-style-plugin`_ (it contains `kcpw-checkout-style.zip`).
- **From the repository:** `npm ci && npm run build:checkout-style` writes `dist/kcpw-checkout-style.zip`.

Nothing else is needed: no other plugin, no JavaScript, no font, no image, no external site.

## 2. Preview first (recommended): see it as an administrator while customers still see the old page

1. In `wp-config.php` (above the line `/* That's all, stop editing! */`) add:

   ```php
   define('KCPW_CHECKOUT_STYLE', 'admins');
   ```

2. Install and activate the plugin (section 3). While that line is there, **only logged-in administrators** get the new look; every customer sees the checkout exactly as before.
3. **Logged in as an administrator in the same browser**, start a checkout the normal way (storefront cart > Checkout), so the cart is rebuilt by `kcpw-core`, and look at the page on a computer **and on a
   phone**. Check:
   - the compact header is the only header; the old tall header and the blue banner are gone (if the banner is still there: section 4);
   - contact, shipping address, shipping options and payment options all show and are usable; the card field and the PayPal button look normal and are not clipped;
   - changing the address or the shipping option updates the shipping and tax lines; a coupon still applies;
   - a personalized item shows its personalization lines in the order summary;
   - on a phone, the order summary opens above the form, nothing scrolls sideways, and Place Order is a full-width orange button;
   - keyboard: Tab reaches the header links, the fields and the button, each with a visible dark outline.
4. To check that **payment** still works, you need an order. If Stripe is in test mode, use a Stripe test card. If it is live, place one real low-value order and refund it in Stripe
   (the same way as in [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md) section 6). The visual checks above need no payment.
5. When you are happy, **delete the `KCPW_CHECKOUT_STYLE` line** (or set it to `'on'`). Then open the checkout in a private window (not logged in) to see what customers see. If a caching
   plugin or CDN caches the checkout page (it should not), purge it.

If you would rather go straight to live, skip the `admins` line: the default is `'on'`.

## 3. Install on the VPS

You do this; I have not touched the server.

**Recommended (no shell): WordPress admin.** _Plugins > Add New Plugin > Upload Plugin_, choose `kcpw-checkout-style.zip`, _Install Now_, then _Activate_. (Your browser upload size limit
is not an issue: the zip is about 12 KB.)

**Alternative (shell on the VPS).** WordPress runs in your own Docker setup that I have not seen, so find where its `wp-content` lives instead of guessing:

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i wordpress        # note the WordPress container's name
docker inspect <that-container> --format '{{range .Mounts}}{{.Source}}  ->  {{.Destination}}{{"\n"}}{{end}}'   # the host folder mounted at .../wp-content (or the whole /var/www/html)
ls -l <that-host-folder>/plugins/                                      # see which user owns the other plugins
```

Then copy the plugin folder in and give it the same owner as the other plugins:

```bash
cd <that-host-folder>/plugins/
unzip /path/to/kcpw-checkout-style.zip            # creates kcpw-checkout-style/
sudo chown -R <same-owner-as-the-others>: kcpw-checkout-style
```

Activate it in _Plugins_ in the WordPress admin. (The plugin keeps nothing in the database, so there is nothing to migrate or clean up.)

## 4. The old blue free-shipping banner

The plugin removes **WooCommerce's store-wide notice** from the checkout page (the _Customizer > WooCommerce > Store notice_ bar, which is the common home of a "Free shipping on orders over $X"
message) and everything inside Astra's header. I do not know which of those, or which other plugin, produces **your** blue banner: that is something only the live page can show.
If it is still visible in the preview:

1. Right-click the banner > _Inspect_. Find the element that is the whole banner and note its `class` or `id`, for example `class="promo-bar"` or `id="free-ship-banner"`.
2. Add it to `wp-config.php`:

   ```php
   define('KCPW_CHECKOUT_STYLE_HIDE', '.promo-bar, #free-ship-banner');
   ```

   Only plain class and id selectors are accepted (at least one class or id each, joined by a space or `>`, up to 20). Anything that names the checkout, a form field, a button or a
   payment method (`checkout`, `payment`, `stripe`, `paypal`, `button`, `input`, `form`, `wc-block`, `express`, ...) is **refused on purpose**, so this setting can never switch off a way to pay.
3. Reload the checkout. It is hidden on this page only; the banner stays wherever else it is used. To remove it from the whole site, turn it off in the place that creates it.

## 5. Settings (all optional, in `wp-config.php`)

| Constant                      | Meaning                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KCPW_CHECKOUT_STYLE`         | `'on'` (default), `'admins'` (administrators only: the preview), `'off'` (the plugin does nothing). A mistyped value counts as `'off'`, so a typo can never switch the look on |
| `KCPW_CHECKOUT_STYLE_PAGE_ID` | The checkout page's ID, default `9`. It is the number after `post=` in the page's address in the WordPress admin                                                  |
| `KCPW_CHECKOUT_STYLE_HIDE`    | Extra elements to hide on the checkout page (section 4)                                                                                                          |
| `KCPW_STOREFRONT_URL`         | You already set this for `kcpw-core` (`https://kcprintworks.com`). The header's logo goes to `<it>/` and "Back to cart" to `<it>/cart/`; after an order, "Continue shopping" goes to `<it>/shop/`. If it is not set, those links stay on the shop |

## 6. Roll back

Fastest first. None of them touches an order, a payment, `kcpw-core` or any other setting, and the plugin stores nothing in the database.

1. **Switch it off without deactivating** (works even if the admin is slow or unavailable, and keeps the plugin installed): add `define('KCPW_CHECKOUT_STYLE', 'off');` to `wp-config.php`. The checkout is
   exactly as before on the next page load.
2. **Deactivate:** _Plugins > Installed Plugins > KCPrintWorks Checkout Style > Deactivate_.
3. **Delete:** _Deactivate_, then _Delete_. Or, with shell access, `rm -r <wp-content>/plugins/kcpw-checkout-style` (WordPress then deactivates it by itself; if the site ever shows an error right after
   installing, renaming that folder does the same).

After any of these: open the checkout in a private window and confirm the old header and look are back; purge a page cache if you use one. To go back to the new look, remove the `'off'` line or reactivate.

**Updating later:** upload the newer zip with _Plugins > Add New > Upload Plugin_ (WordPress offers to replace the old version), or replace the folder.

## 7. Why this is safe for payments (and how that is enforced)

- **Scope.** The plugin looks at one page. On every other page it adds nothing. On the checkout page it adds a body class `kcpw-checkout`, **one stylesheet, one tiny inline rule and the header**, and
  empties WooCommerce's store-notice markup (the notice _setting_ is not changed). It registers no route, AJAX action, redirect or script, and cannot read or write the cart, an order, an option or the database.
  A PHP test scans the plugin's code and fails if it ever contains any of those calls.
- **The stylesheet.** Every rule starts with `body.kcpw-checkout`, so it cannot reach another page. Rules aimed at payment methods set only colors, border color and corner radius: **no size, position, overflow, stacking or transform**, and no rule
  mentions an iframe, because Stripe and PayPal draw and measure their own elements. A test enforces this (and that nothing is requested from anywhere: no fonts, images, `@import` or `url()`), and a browser
  test checks that switching the stylesheet on changes none of the payment container's geometry, overflow or stacking.
- **Layout is WooCommerce's.** The Checkout Block switches between one and two columns itself (container queries); the stylesheet sets colors, type, borders and spacing, not column widths.
- **Fast.** One request of about 3 KB compressed, only on the checkout page; system fonts; no JavaScript; nothing that blocks rendering beyond that stylesheet.
- **Accessible.** Contrast for every pairing is tested against WCAG 2.2 AA (text 4.5:1, borders and focus rings 3:1); the header has one `<header>`, two links with 44px targets, a decorative icon hidden from screen readers; focus rings are 3px dark; error states use text and a thicker border, never color alone; reduced-motion is respected; an accessibility scan runs at 1280, 768, 375 and 320 px.

## 8. What is verified, and what is not

Verified here:

- PHP: syntax (`php -l`), 28 tests with WordPress stand-ins (settings and their safe fallbacks, escaping, which hooks are added and when, the page scoping, the `admins`/`off` modes, the code scan above).
- CSS: the rules above, the tokens equal to the storefront's `tokens.css`, WCAG contrast, size budget.
- A browser rendering of a **stand-in** checkout page (24 tests, 4 widths): header, hidden theme header and notice, button colors, no sideways scroll, no accessibility violations, payment geometry unchanged, nothing changes
  without the page class, keyboard focus, no external requests. I also looked at screenshots at 1280, 375 and 320 px.

**Not verified (the sandbox cannot reach any of it):**

- The real page. The stand-in is hand-written from the open source of WooCommerce Blocks: class names and layout rules come from a public copy of that source on npm (a recent snapshot of unconfirmed origin), and
  your installed WooCommerce version may differ in details. Astra's selectors (`#masthead`, `#ast-mobile-popup-wrapper`, `.ast-article-single`, `.site-footer`, ...) are from my knowledge of Astra's markup, not from your site.
  A selector that does not exist on your page simply does nothing (you would see the old element): then use section 4.
- Stripe's and PayPal's actual elements. The tests prove the stylesheet does not touch their containers; only a real order proves they behave.
- Which element is **your** blue banner (section 4), and what your footer looks like (only its colors are changed: ink background, cream text, like the storefront's footer).
- The order-confirmation page after payment (it is the same page, so it gets the header with "Order confirmation" and "Continue shopping", and light styling); its exact markup depends on your WooCommerce version.

## 9. If something looks wrong

### Is it running? (one minute)

On the checkout page, right-click > **View page source** (Ctrl+U) and search for `kcpw-checkout`.

- **Found** (you will see `kcpw-checkout` in the `<body class="...">`, and `kcpw-checkout-style-css` in a `<link>`): the plugin is running on this page. If it still looks old, another plugin's stylesheet or a cache is in the way: send me a screenshot.
- **Not found:** the plugin is not running on this page. The usual reasons, most likely first:
  1. It was uploaded but not **activated** (Plugins > Installed Plugins).
  2. You used the preview line (`KCPW_CHECKOUT_STYLE` = `'admins'`) and this browser is **not logged in as an administrator**. A logged-out visitor, and any customer, sees the old page on purpose. The checkout shows a "Log in" link and "You are currently checking out as a guest" when nobody is logged in; as a logged-in administrator you would see your own account's email instead. Log in to WordPress in the same browser first, then open the checkout.
  3. `KCPW_CHECKOUT_STYLE` is `'off'`, or mistyped (a typo counts as `'off'`).
  4. A cache (a caching plugin, the host, or a CDN such as Cloudflare) is serving an older copy of the page: purge it, and hard-refresh (Ctrl+F5).
  5. The checkout page's ID is not 9 (see the address of the page in the admin: `post=<number>`): set `KCPW_CHECKOUT_STYLE_PAGE_ID`.

### What you may see, and what to do


| What you see                                           | Likely cause and fix                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing changed                                        | The plugin is not active, `KCPW_CHECKOUT_STYLE` is `'off'` (or mistyped), you are not an administrator while it is `'admins'`, the checkout page's ID is not 9 (set `KCPW_CHECKOUT_STYLE_PAGE_ID`), or a cache serves the old page |
| Two headers (the theme's and ours)                     | Your theme's header is not `#masthead`. Inspect it, note its `id`/`class`, and add it with `KCPW_CHECKOUT_STYLE_HIDE`                                                       |
| "Back to cart" goes to the shop's own cart             | `KCPW_STOREFRONT_URL` is not set (or is not an `https` address) in `wp-config.php`                                                                                          |
| A payment field is cut off or misplaced                | Set `KCPW_CHECKOUT_STYLE` to `'off'` right away (section 6) and send me a screenshot and the page's address                                                                  |
| The page is unstyled in places                         | A stylesheet from another plugin is overriding it. Send a screenshot; the element's `class` shows which rule to adjust                                                      |
