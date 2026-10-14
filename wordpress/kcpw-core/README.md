# KCPrintWorks Core (checkout link and personalization)

Version 0.2.1. A WordPress plugin for the shop site (WooCommerce). It does four things and nothing else:

1. **Checkout link.** The storefront (a separate Next.js site) sends the cart to this plugin, server to server, signed with a shared secret.
   The plugin validates every line against WooCommerce (product exists and is for sale, the chosen variation is valid including WooCommerce's
   "Any" options, stock and quantity, personalization), computes the prices itself, stores the cart server-side behind a single-use 10-minute
   token, and returns a link. The shopper's browser follows the link; the plugin rebuilds the WooCommerce cart with WooCommerce's own
   add-to-cart and sends them to the WooCommerce checkout.
2. **Personalization.** A "Personalization" tab on the product screen defines the fields shoppers fill in (text, choices, checkbox, extra
   charges). The values are validated again on the server, shown in the cart, and saved on the **order item** as readable lines plus a hidden
   `_kcpw_personalization` record.
3. **Customer reviews (0.2.0).** The storefront sends a review the shopper wrote, server to server, signed with the same secret. The plugin
   checks it with exactly the same rules the storefront used (shared test vectors), applies WooCommerce's settings (reviews on, ratings on,
   "only verified owners", one review per email per product), and saves it as a **pending** WordPress review with its star rating through
   WordPress's own comment pipeline. It never publishes anything: a person approves it in Products > Reviews. "Verified" is WooCommerce's
   own call, made from the email address; a request that claims it (or an approval, or a status) is refused.
4. **A status page** (WooCommerce > Checkout link) that says whether all of the above is ready.

It **never** creates, edits, or deletes products, contains **no payment code** (the official Stripe plugin takes payments), and calls
**no external service**. It works with whatever tool fills WooCommerce with products. Tests fail if any of that stops being true.

## Install and settings

See [docs/CHECKOUT-STAGING-CHECKLIST.md](../../docs/CHECKOUT-STAGING-CHECKLIST.md). Installing it changes the site it is installed on: do it on staging first.

Two constants in `wp-config.php`:

| Constant | Meaning |
|---|---|
| `KCPW_HANDOFF_SECRET` | 32+ random characters, the same value as the storefront's `KCPW_HANDOFF_SECRET`. Without it every request is refused (HTTP 503) |
| `KCPW_STOREFRONT_URL` | The storefront's address, used only to send a shopper back to the cart if the cart changed or the link was already used. Reported by `GET /status` (0.2.1) so the storefront can refuse a shop that would return shoppers to a different site: **one shop serves one storefront**, so set it to `https://kcprintworks.com` when production checkout goes live (see [docs/CHECKOUT-PRODUCTION.md](../../docs/CHECKOUT-PRODUCTION.md)) |

## What it stores

| Where | What | On delete |
|---|---|---|
| Table `{prefix}kcpw_handoff` | pending carts as line **intents** (product, variation, quantity, choices): never prices; the token itself is not stored, only its hash. Expired rows are purged daily | Dropped |
| Product meta `_kcpw_option_schema` | the personalization setup (JSON) | **Kept** |
| Order item meta (readable lines + `_kcpw_personalization`) | what the customer chose | **Kept** (orders must stay readable) |
| WordPress comments (type `review`) | each submitted review, **pending** until a person approves it, with its `rating` meta (and WooCommerce's own `verified` meta) | **Kept** (they are your customers' reviews) |
| Transients | request nonces (replay protection), form messages, review-flood counters (`kcpw_rv_` plus a hash; no email or address in the name or value) | Expire |

## Endpoints (server to server only; every request must be signed)

`POST /wp-json/kcpw/v1/cart/quote` (checks and prices, stores nothing) · `POST /wp-json/kcpw/v1/cart/handoff` (checks, stores, returns the link) ·
`POST /wp-json/kcpw/v1/reviews` (saves a pending review) · `GET /wp-json/kcpw/v1/status`. Cart request bodies are strict: any field other than `lines` and `expectedSubtotal` (a price, a total, a discount) is
rejected. Signing: [`src/Auth/RequestSigner.php`](src/Auth/RequestSigner.php); the same vectors are tested on the storefront side.

## Development

```bash
php wordpress/kcpw-core/tests/run.php            # all tests, no dependencies
php wordpress/kcpw-core/tests/run.php Redeemer   # tests whose name contains "Redeemer"
```

`src/` outside `Wp/` is plain PHP with no WordPress calls (a test enforces that). The shared vectors in `packages/contracts/test/vectors/`
(`options.json` 33 cases, `lines.json` 29 cases, `reviews.json` 60+ cases, `signing.json`) are generated from the storefront's TypeScript reference; passing them
is how "the server decides exactly as the storefront shows" is proven. `src/Wp/` is the thin layer over WordPress and WooCommerce; its tests use
stubs written from the documented behavior, so **it is only proven against a real site by the staging checklist**.
