# The storefront's WooCommerce catalog (Step 2)

Status: **built and tested against a mock store; not yet run against kcprintworks.com** (this sandbox cannot reach it, and you have not created the
read-only key yet). With `CATALOG_SOURCE=woo` the storefront shows the published products from WooCommerce instead of the placeholder ones.

```
WooCommerce (kcprintworks.com)                       VPS container kcprintworks-nextjs
 products, variations, categories   ── GET, Read-only key ──>  in-memory catalog (refreshed in the background)
 (never written to)                                                      │ shoppers are answered from memory
 product saved ──(optional webhook / script)── POST /api/revalidate/ ──> "refresh now" (signed)
```

Nothing in WooCommerce is created, changed, or deleted by this path. Etsy is not involved in it: Etsy products reach WooCommerce through the owner's
synchronization service, and the storefront only ever reads WooCommerce ([SYNC-INDEPENDENCE.md](SYNC-INDEPENDENCE.md)). Checkout is a separate, off-by-default path ([CHECKOUT-STAGING-CHECKLIST.md](CHECKOUT-STAGING-CHECKLIST.md)).

## 1. What is read

All with `GET https://<WC_BASE_URL>/wp-json/wc/v3/...` and HTTP Basic credentials sent in a header (never in the URL), over https only (plain http is accepted only for localhost
tests), with redirects refused (so the key can never be forwarded to another host) and a 15 s timeout:

| Request | Used for |
|---|---|
| `/products?status=publish` (100 per page, all pages) | the 66 published products: name, slug, SKU, prices, sale state, stock, categories, images, attributes, description, last-modified, meta |
| `/products/{id}/variations` for each **variable** product (4 at a time) | variation IDs, SKUs, prices, sale prices, stock status, chosen attributes, status |
| `/products/categories` | category names, slugs, descriptions |

The client object has two methods, `get` and `getAll`, and no way to send anything else. The mock store used in the tests answers `GET` only, counts any other method, and the end-to-end suite
asserts that count is zero.

## 2. How WooCommerce data becomes storefront data

| WooCommerce | Storefront | Notes |
|---|---|---|
| `slug` | product address `/product/<slug>/` | The real slug, so existing product URLs keep working (trailing slash, as WooCommerce) |
| `id`, variation `id` | product and variation IDs | **Preserved exactly.** Cart lines carry them |
| `price` / `regular_price` / `on_sale` | `price` / struck-through `regularPrice` | Whole cents (no floating point). A variable product shows "From" its lowest variation price |
| variation `attributes[].option` blank | the variation matches **any** option ("Any") | Not expanded, not invented. 169 "Any" variations stay 169 variations and two color pickers |
| variation `status` other than `publish` | not sold | Disabled variations are private in WooCommerce |
| attribute `Condition`, `MPN`, and other marketplace attributes that are not used for variations | hidden from shoppers | **Display only**; nothing changes in WooCommerce. `Condition = MADE_TO_ORDER` marks the product made-to-order |
| `description`, `short_description` | rich text, sanitized again at render time with an allowlist | Script and style content never reaches the page or the meta description |
| `images[]` | gallery | Photos are resized by Next only from `kcprintworks.com` and its subdomains (`IMAGE_HOSTS` build argument for others); a photo from any other host is shown unresized instead of breaking the page |
| `stock_status` | in stock / sold out / on backorder | Not the quantity |
| `categories` | category pages and navigation | Only categories that contain products; `uncategorized` is never listed |
| `meta_data._kcpw_option_schema` | the personalization form | Used when present and valid. Until the `kcpw-core` module writes it, products whose titles say "Personalized" or "Custom Name" get **proposed** fields (still validated server-side at checkout, which is not connected yet) |
| draft / private / hidden-from-catalog products, unsupported product types | not shown | Listed with the reason by `/api/catalog-status/` |

A product that does not fit the storefront's contract is skipped and reported (id, title, reason), never guessed at.

## 3. Staying fresh without a rebuild

The catalog is **not** frozen into the Docker image. Pages are rendered per request from an in-memory copy:

- **Background refresh.** A copy older than `CATALOG_REVALIDATE_SECONDS` (default 120, minimum 5) is still served immediately while exactly one refresh runs; shoppers never wait for WooCommerce.
- **Refresh now.** `POST /api/revalidate/` with an HMAC-SHA256 signature of the body (`REVALIDATE_SECRET`) marks the copy stale and starts loading; the next page view waits for the fresh copy.
  Accepted signatures: `X-WC-Webhook-Signature` (base64, what a WooCommerce webhook sends) and `X-KCPW-Signature: sha256=<hex>` (what the script sends). With no secret set the endpoint answers 503.
- **WooCommerce down or erroring.** The last good catalog keeps being served, the error is recorded (visible in `/api/catalog-status/`), and a retry happens after 15 s. A cold start with WooCommerce down shows the error page, because there is nothing to show yet.
- **Races.** A change that arrives while a load is already running is not lost: the next read starts a second load (generation counter, unit-tested).
- One container holds one cache. If you ever run several, each refreshes itself on the interval; only the one that receives the webhook refreshes at once.

### Verify it yourself (no Docker rebuild, no restart)

Run these on **your own computer** (not on the VPS, not in a chat). Replace the address with your staging URL.

```bash
git clone https://github.com/cyberbandit1998/KcPrintworks && cd KcPrintworks    # or open your existing clone; Node 22 is the only requirement

# 1. What does the storefront see right now?
node scripts/verify-catalog-freshness.mjs status --base https://STAGING-URL
#    expect: "Catalog source: WooCommerce   products: 66" (or the number you have published), last loaded N seconds ago, no "Last error"
#    --product <id or slug> prints that one product's price, variation count and last-modified time

# 2. Change something small in WooCommerce yourself (for example add a harmless word to a product's SHORT description on a product you are happy to touch,
#    or publish a brand-new test product, then trash it afterwards). This script never changes anything in WooCommerce.

# 3a. Wait for the change to appear on its own (within CATALOG_REVALIDATE_SECONDS, default 2 minutes):
node scripts/verify-catalog-freshness.mjs wait --base https://STAGING-URL --path /product/YOUR-SLUG/ --expect "the new text" --timeout 300

# 3b. Or make it appear immediately (needs the same REVALIDATE_SECRET that is in the VPS .env; type it, never paste it into a chat):
read -rsp 'REVALIDATE_SECRET: ' REVALIDATE_SECRET; echo; export REVALIDATE_SECRET
node scripts/verify-catalog-freshness.mjs refresh --base https://STAGING-URL
node scripts/verify-catalog-freshness.mjs wait    --base https://STAGING-URL --path /product/YOUR-SLUG/ --expect "the new text" --timeout 30
```

`wait` prints `PASS  visible after N s (no rebuild, no restart)`. To check a *removal* use `--gone "old text"`. Exit codes: 0 passed, 1 failed or timed out, 2 usage error.
`refresh` explains a failure: 401 = the secret differs from the server's, 503 = the server has no `REVALIDATE_SECRET` or WooCommerce credentials, 404 = the container is not using the WooCommerce source.

**Optional, for instant updates:** a WooCommerce webhook (WooCommerce > Settings > Advanced > Webhooks > Add: topic _Product updated_ (and _created_, _deleted_), delivery URL
`https://STAGING-URL/api/revalidate/`, secret = `REVALIDATE_SECRET`). That adds a webhook to the live WooCommerce configuration, so it **needs your approval** and is not required:
the two-minute background refresh keeps the site current without it.

To prove the "without a rebuild" part: `docker inspect --format '{{.Image}} {{.State.StartedAt}}' kcprintworks-nextjs` before and after; both are unchanged when the product appears.

## 4. Settings (VPS `.env`, never in the image)

| Variable | Meaning |
|---|---|
| `CATALOG_SOURCE` | `fixtures` (placeholder, default) or `woo` |
| `WC_BASE_URL` | `https://kcprintworks.com` now; `https://shop.kcprintworks.com` after the domain move (a one-line change plus `docker compose up -d`) |
| `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` | a WooCommerce REST key with **Read** permission, created by you; only in this file (`chmod 600 .env`) |
| `CATALOG_REVALIDATE_SECONDS` | background refresh interval, default 120 |
| `REVALIDATE_SECRET` | signs refresh requests; 16+ random characters (`openssl rand -hex 24`); empty = endpoint off |

Build-time (image) settings that cannot be changed from outside: `SITE_ENV`, `NEXT_PUBLIC_SITE_URL`, `IMAGE_HOSTS`.

## 5. Security notes

- The key is Read-only in WooCommerce and the client cannot write, so a leaked key could read product data (which is public anyway) and orders/customers **only if** the key were created with broader access. Create it with _Permissions: Read_.
  WooCommerce REST keys read *everything* the permission allows, including orders and customers, so treat the key as sensitive and keep it out of chats and the repository.
- The key reaches the server only through the container environment. It is not in the image, the browser bundle, the HTML, `/api/catalog-status/`, or logs (a Playwright test scans every page and script for it).
- `/api/catalog-status/` shows only what product pages already show (id, address, name, price, variation count, last-modified), counts, and the last error text (for example "WooCommerce returned HTTP 401"); no address or credential.
- `/api/revalidate/` is HMAC-signed, size-limited (256 KB), constant-time compared, and does nothing except mark the cache stale and reload it.
- The browser still never supplies prices: the quote endpoint prices cart lines from this catalog and rejects a `price` field.

## 6. Known limits (honest list)

- **Not run against the real store.** The converter was written against WooCommerce's documented REST shapes and tested with synthetic data that mirrors the export's oddities. The first real load may expose
  fields that differ; `/api/catalog-status/` lists every skipped or rejected row, and a failure never breaks the shop (the last good copy is kept), but there is no last good copy on the very first load.
- **Photo sizes** are assumed square until the browser loads them (WooCommerce's list endpoint does not give dimensions).
- **Prices in the quote** come from the cached catalog (up to the refresh interval old). WooCommerce remains the authority at checkout, which is not connected yet.
- **Image optimization** needs the container to reach `kcprintworks.com` outbound (it normally can) and was only verified with a local photo in CI.
- **Login-protected or staging-protected WooCommerce** (basic-auth, IP allowlists, WAF bot challenges) can block the VPS; the symptom is "WooCommerce returned HTTP 401/403" in the status endpoint.
- **Webhook** is optional and not created by this work (it changes live WooCommerce settings).
