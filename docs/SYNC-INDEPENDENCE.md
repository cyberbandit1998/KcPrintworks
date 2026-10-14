# Independence from the Etsy synchronization service

Status: **built and tested; the real services have not been run against it.** ADR-014 (2026-10-14).

The owner synchronizes Etsy listings into WooCommerce with a third-party service (ExportYourStore today, possibly Nembol later).
That service is a **producer of WooCommerce data**, nothing more. The storefront and the WordPress plugin we ship do not know
which service is in use, call neither service nor Etsy, and need no code change when the service changes.

```
Etsy ──(sync service of your choice)──> WooCommerce ──(standard REST, read-only)──> Next.js storefront
                                            │                                          │
                                            └──── kcpw-core plugin (checkout link, personalization) <── signed server calls
```

## The contract: what the storefront relies on

Only **standard WooCommerce data**, plus metadata that **we** own:

| Needed from WooCommerce | Notes |
|---|---|
| Published products of type simple or variable: name, slug, status, description, price, sale price, stock status, categories, tags, images, attributes | The REST API v3 fields every WooCommerce store has |
| Variations: id, status, price, stock status, chosen attribute values (blank = "Any") | "Any" is kept as "Any" |
| Product and variation **IDs** | Carts and orders refer to them |
| `_kcpw_option_schema` product meta (personalization fields) | **Ours**: written by the kcpw-core editor, never by a sync service |
| `_kcpw_made_to_order` meta or the `made-to-order` tag (optional) | **Ours**, optional hint |

Everything else is ignored. In particular the storefront **does not read** any meta key, field, or attribute that a sync service
adds for its own bookkeeping, and it **does not require** any of them. A unit test adds dozens of unknown fields and meta keys
to every product and variation and asserts the output is identical.

### Display hints (optional, configurable)

Sync services often copy marketplace attributes (Condition, MPN, Primary color, Occasion, ...) onto products. Those are not
useful to shoppers, so by default the storefront **hides** a short list of such attribute names **from display only** (nothing is
changed in WooCommerce), unless an attribute is used to choose a variation. Change the list with `CATALOG_HIDDEN_ATTRIBUTES`
(comma-separated, case-insensitive; empty = hide nothing). A description footer such as "Listed with <service>.com" is removed
from display by its shape, not by service name. "Made to order" is shown if the product has the `made-to-order` tag, our own
`_kcpw_made_to_order` meta, or a marketplace-style Condition value that says so. If none of these exist, the catalog renders
the same, just without the note.

## What this protects, and what it cannot

| Situation | Behavior |
|---|---|
| A service writes extra meta/attributes the storefront has never seen | Ignored |
| A service stops writing marketplace attributes | Nothing to hide; nothing breaks |
| Variations written as "Any" or as explicit combinations | Both work (tested); IDs are WooCommerce's |
| A cart holds a product that disappeared | The cart says "no longer available"; nothing is charged |
| A cart holds a variation id that disappeared | "Choose again"; never a wrong price |
| Photos hosted on a host other than your domain | Shown as they are (not resized); add the host to the `IMAGE_HOSTS` build argument to resize them |
| A service **changes product IDs or slugs** when it re-imports (creates new products instead of updating) | **Not preventable here.** Old product addresses and saved carts break, and personalization setups (stored on the old products) are lost. See the switching checklist |
| A service overwrites our meta | We have not been able to verify that either service leaves unknown meta alone. **Test it** (checklist step 4) and keep the JSON backup of each setup |
| A service sets made-to-order items to "out of stock" or a stock count | WooCommerce is the authority and the storefront shows what WooCommerce says. Fix it in WooCommerce or in the service's settings |

## Switching services: checklist

Do this on staging first. None of it changes the live store without your approval.

1. **Baseline.** Export your WooCommerce products (CSV) and run `node scripts/discovery/analyze-wc-export.mjs <csv>`; keep the file.
   Save `https://STAGING/api/catalog-status/` (product ids, slugs, last-modified).
2. **Find out how the new service matches products.** Does it update existing products (by SKU or listing id) or create new
   ones? If it creates new ones, you will get duplicates and new IDs: stop and ask it to link to the existing products first.
3. **Back up personalization.** On each personalized product, open Product data > Personalization > Advanced and keep the JSON
   (or tell me and I will add a bulk export).
4. **Run the new service on a staging copy of WooCommerce**, then check: the same product count and slugs in
   `/api/catalog-status/`, variation counts, `skipped` reasons, that `_kcpw_option_schema` survived (open one personalized product),
   and one test checkout with a personalized item ([CHECKOUT-STAGING-CHECKLIST.md](CHECKOUT-STAGING-CHECKLIST.md)).
5. **Photos.** If the new service hosts images elsewhere, add that host to `IMAGE_HOSTS` and publish a new image.
6. **Only then** switch the live store, with a fresh backup of the WooCommerce database first.

## How this is enforced in the code

- `npm run guard` fails the build if shipped code (storefront, shared packages, WordPress plugin, deploy files, workflows)
  mentions Etsy's API, an Etsy credential, or a synchronization product by name. Documentation may.
- `apps/storefront/tests/unit/sync-independence.test.ts` pins the behaviors above.
- `wordpress/kcpw-core` reads products only through WooCommerce's own getters, never through another plugin's data, and a test
  fails if it writes to products (the two allowed writes are its own meta key and its own cart/order lines).
