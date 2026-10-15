# Decisions and Open Inputs

Last updated 2026-10-14. **WooCommerce is the single source of truth; a third-party sync service (ExportYourStore now, maybe Nembol later) fills it from Etsy and we build no Etsy integration (ADR-014).** The cart hands off to WooCommerce checkout through the `kcpw-core` plugin; Stripe is the official plugin.

## 1. Decision status

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | Domain topology: Next.js at `kcprintworks.com`; WordPress/WooCommerce (admin, checkout, REST, webhooks) at `shop.kcprintworks.com` | **Approved** 2026-10-13 |
| ADR-002 | Hybrid checkout: Next.js storefront and cart; WooCommerce-hosted checkout with the **official** Stripe plugin; secure single-use cart handoff | **Approved** 2026-10-13. **Built 2026-10-14** (`kcpw-core` + storefront), off by default, tested with stand-ins only; staging checklist pending |
| ADR-003 | Etsy sync is a separate WooCommerce plugin (`kcpw-etsy`) | **Withdrawn 2026-10-14** (ADR-014): the owner uses a third-party sync service. The plugin was built (read-only) and removed; it is in git history at `29cc10f` |
| ADR-004 | Etsy orders imported as WooCommerce orders marked "Paid on Etsy" | **Withdrawn** (ADR-014): if Etsy orders reach WooCommerce, the sync service does it; the storefront does not care |
| ADR-005 | WooCommerce owns the website; per-field ownership; import-once defaults; Woo-owned SEO | **Restored in spirit by ADR-014**: WooCommerce is the single source of truth for the website. Field-level sync rules belong to the sync service, not to us |
| ADR-006 | Etsy access class: **Seller App / Seller API Access**, read-only scopes first | **Revised 2026-10-13** (was "personal access"). 2026-10-14: scopes `shops_r` + `listings_r` now; `transactions_r` only with order import; still no write scope |
| ADR-007 | Personalization solution | **First-party `kcpw-core` module, built 2026-10-14** (editor on the product screen, server-side validation proven against 33 shared vectors, saved on the order item). Open: icons decision, cable colors, order sample; staging verification |
| ADR-008 | Catalog delivery to Next.js | **Revised 2026-10-14, Step 2 built:** the storefront reads the WooCommerce REST API (GET only, read-only key, in-memory stale-while-revalidate cache, signed refresh endpoint). Purpose-built DTO endpoints stay a later optimization |
| ADR-009 | Migration strategy: clone then cut over; live site stays operational | **New, proposed** |
| ADR-010 | Etsy `order.paid` webhook as fast path with polling as recovery | **Withdrawn** (ADR-014) |
| ADR-011 | Accessible foreground colors on the unchanged brand palette | **Approved** 2026-10-13 |
| ADR-012 | Storefront runs as a Docker image published to GHCR; staging by default; rollback by image tag | **Implemented**, owner requested 2026-10-13. Revised 2026-10-14: pages are rendered per request; noindex and image hosts are still fixed at build |
| ADR-013 | Etsy is the master product catalog, synchronized by our own plugin | **Superseded the same day by ADR-014** (owner decision) |
| ADR-014 | **WooCommerce is the single source of truth; the Etsy sync service is external and interchangeable; no custom Etsy integration; the storefront is sync-neutral** | **Owner decision 2026-10-14. Implemented** |
| ADR-015 | **The cart's free-shipping bar is a display of one configured number** (`FREE_SHIPPING_THRESHOLD`, default $40.00, runtime), computed from the items total only; WooCommerce decides and charges the shipping. When eligibility cannot be known accurately, nothing is shown or promised | **Owner request 2026-10-14. Implemented**, see [FREE-SHIPPING.md](FREE-SHIPPING.md) |
| ADR-016 | **Navigation, categories as a tree, Featured / New Arrivals, and a WordPress-managed blog, Our Story and Contact** (header Shop \| Game Cases \| Personalized Gifts \| New Arrivals \| Blog \| Cart; categories are settings; content read from the public WordPress REST API through a hardened sanitizer) | **Approved by the owner and implemented 2026-10-14.** Tested against stand-ins; not yet run against the real WordPress |
| ADR-017 | **Customer reviews are real, approved and moderated**: display only WooCommerce's approved reviews and its own ratings; writing a review is saved as pending by `kcpw-core` 0.2.0, never published by us, never able to claim "verified" | **Approved by the owner and implemented 2026-10-14.** Writing is **off by default** (`REVIEWS_SUBMIT_ENABLED`); the WordPress glue is proven only by the staging checklist |
| ADR-018 | **Production checkout is allowed, behind strict validation, and a staging build can never reach real payments**: a production image may take checkout only with an https shop, an https storefront address built into the image, the live catalog and a handoff secret; staging only hands a cart to a shop that reports Stripe TEST mode; production only to a shop that returns shoppers to the same storefront. Off by default; a second container runs production beside staging | **Owner request 2026-10-14 (replaces the "never in a production build" rule of ADR-002). Implemented**; tested with stand-ins; the real chain is proven by [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md) §6 |
| ADR-019 | **The WooCommerce checkout is dressed as the storefront by a separate, styling-only WordPress plugin** (`kcpw-checkout-style`): compact header, storefront tokens, scoped to the checkout page, payment elements untouched, off-switch and administrators-only preview | **Owner request 2026-10-14. Built**; tested against a stand-in page only; the real page is checked by the owner's preview step in [CHECKOUT-STYLE.md](CHECKOUT-STYLE.md) |

## 2. Inputs still needed

Answering these unlocks the corresponding work. Most are covered by the read-only procedure in
[LIVE-SITE-DISCOVERY.md](LIVE-SITE-DISCOVERY.md).

1. **Live-site inventory** (plugins, versions, theme, WooCommerce settings, HPOS). Blocks ADR-007 and the
   migration plan. I could not inspect the live site from my environment. **Partly done:** the product export was
   received and analyzed ([discovery/INVENTORY.md](discovery/INVENTORY.md)); it raised nine owner questions (Q1 to Q9
   there), the most important being whether the catalog's variations really are "Any" and how buyers enter
   personalization text today.
2. **Catalog and personalization facts:** how personalization works today, whether it is per line item or per
   unit, and whether any product uses file upload (I assume none until discovery shows otherwise).
3. **Hosting facts:** provider, PHP version, WP-CLI/cron availability, DNS provider, email hosting
   ([MIGRATION-SHOP-DOMAIN.md](MIGRATION-SHOP-DOMAIN.md) §11).
4. **Staging location:** hosting-provider staging, a separate host, or a new staging subdomain (the last is a
   DNS change needing your approval).
5. **Stripe:** account status, who supplies test keys, link on or off, statement descriptor, tax approach.
6. **Shipping and tax** approach, and countries served.
7. **Next.js hosting** (Vercel assumed).
8. **Sync service (ExportYourStore today):** which products it keeps in sync, whether it updates existing products in place or creates new ones, and how it sets stock for
   made-to-order items (docs/SYNC-INDEPENDENCE.md). Needed before any switch to another service.
9. **Staging WordPress + WooCommerce for the checkout tests (new, blocks Step 3 verification):** a copy of the shop where `kcpw-core` and the
   official Stripe plugin (test mode) can be installed ([CHECKOUT-STAGING-CHECKLIST.md](CHECKOUT-STAGING-CHECKLIST.md)). Installing them
   on the live site would change it, so it needs your approval.
10. **WooCommerce read-only REST key (new, blocks Step 2 on the real catalog):** you create it (Read permission) and put it only in the
    VPS `.env` ([DEPLOYMENT-VPS.md](DEPLOYMENT-VPS.md) section 9).
11. **Network access for verification work (optional, would remove the biggest gap):** allow `wordpress.org`, `downloads.wordpress.org` and
    `kcprintworks.com` in the environment's network settings
    (<https://code.claude.com/docs/en/cloud-environments#network-access>). With WordPress and WooCommerce downloadable I could run
    the `kcpw-core` plugin inside a real WordPress here instead of against stubs, and read real catalog responses from your store.

## 3. Decision log

Format: context, decision, consequences.

### ADR-001 — Domain topology (Approved)

- **Context.** The Stripe plugin, Apple Pay domain registration, and webhooks must live on a host that runs
  WooCommerce. Next.js is on a different runtime. The current WooCommerce site occupies `kcprintworks.com`.
- **Decision.** `kcprintworks.com` (apex, canonical) serves Next.js; `www` redirects to it;
  `shop.kcprintworks.com` serves WordPress.
- **Consequences.** Apple Pay is registered on `shop.`. Cookies are host-only, so the cart is handed over rather
  than shared. WordPress public pages other than checkout and account redirect to the apex. Because the apex
  currently hosts the live store, the move is a **clone-then-cutover** (ADR-009). No DNS change is made without
  approval.

### ADR-002 — Hybrid checkout with the official Stripe plugin (Approved)

- **Context.** The brief says to use the official plugin unless something is demonstrably better supported. No
  documentation I could reach supports driving the plugin's payment flow from a separate frontend.
- **Decision.** Next.js owns browsing and cart; WooCommerce owns checkout and payment status. A validated,
  single-use handoff transfers the cart (PAYMENTS-STRIPE §4).
- **Consequences.** Minimal payment code of our own; checkout is a themed WooCommerce page; wallet buttons are
  not on `www` pages in v1.
- **Reversal trigger.** Step 3 spikes fail, or the checkout look is rejected at G1/G2. Then option C in
  PAYMENTS §12, after you approve.

### ADR-003 — Etsy sync as a separate WooCommerce plugin (Withdrawn by ADR-014)

> Withdrawn 2026-10-14: the owner uses a third-party sync service. Kept for the record.


- **Context.** Needs: direct WooCommerce CRUD, transactions, a job queue, retries, WP admin authorization, and
  strict isolation from shoppers.
- **Decision.** `kcpw-etsy` plugin using Action Scheduler, driven by cron, separate from `kcpw-core`.
- **Alternatives.** A separate Node worker: type-sharing with Next.js and process isolation, but it needs its
  own queue, state, and authenticated admin, and would write to WooCommerce through REST without transactions.
- **Consequences.** Sync shares the WordPress host with checkout, so load is managed with batch limits,
  concurrency 1, and a load test (R7). The plugin boundary and kill switch keep it removable. Shared hosting
  may make this harder (MIGRATION §10).

### ADR-004 — Etsy orders as WooCommerce orders (Withdrawn by ADR-014)

> Withdrawn 2026-10-14. Kept for the record.


- **Context.** "Import into WooCommerce or a consolidated fulfillment view."
- **Decision.** Import as WooCommerce orders with payment method "Paid on Etsy".
- **Pros.** One queue; packing slips, shipping-label plugins, and exports work unchanged; personalization is
  visible in one place.
- **Cons and mitigations.** Revenue and tax reports include Etsy sales (filter by source in Step 9); customer
  emails must be suppressed (filters and no recipient); stock is never touched by default (rule-driven);
  refunds must not hit Stripe (gateway without refund support).
- **Alternative.** A separate table and fulfillment page: cleaner reports, but loses the plugin ecosystem and
  duplicates fulfillment UI.

### ADR-005 — Source of truth and field ownership (Superseded by ADR-013)

> Superseded 2026-10-14: the owner chose Etsy as the master catalog. The mechanisms below (per-field policy, three-way conflict detection,
> preview before apply) are kept and reused by ADR-013 with the ownership reversed for titles, descriptions, images, variations, colors, and base prices.

- **Decision.** Per-field policy (ETSY §7), WooCommerce owns the website, import-once defaults, SEO and
  WooCommerce-specific options never written, three-way conflict detection, preview required before apply.
- **Consequences.** More up-front configuration; much lower risk of overwriting SEO copy, prices, or variations.

### ADR-006 — Etsy access class and scopes (Withdrawn by ADR-014)

> Withdrawn 2026-10-14: we make no Etsy API calls. Kept for the record.


- **Context.** The owner reports that Etsy introduced Seller API Access in July 2026 for sellers connecting their
  own shops. Excerpts of Etsy's help center agree: a Seller App covers the registered shop only, cannot serve
  other sellers, and approval is typically quick. I could not open Etsy's pages, so details remain to be verified.
- **Decision.** Register a **Seller App**; do not apply for Commercial Access. Scopes `shops_r`, `listings_r`,
  `transactions_r` only until a write feature is approved; no `listings_d`; `email_r` off by default.
- **Consequences.** Replaces the earlier "personal access" plan. The app may only ever be used with this shop.
  Confirm rate limits, scope list, and the effect of any existing registered app on the real page in Step 5,
  using Etsy's Dev MCP server and the official OpenAPI spec (ETSY §2.1).

### ADR-014 — WooCommerce is the source of truth; the sync service is external and interchangeable (Owner decision 2026-10-14)

- **Context.** The owner already synchronizes Etsy listings into WooCommerce with ExportYourStore and may switch back to Nembol. The
  previous day's plans (ADR-005 WooCommerce-master, then ADR-013 Etsy-master with our own `kcpw-etsy` plugin) assumed we would build
  the Etsy connection. The owner does not want that, and wants the new storefront to keep working whichever service is in use.
- **Decision.**
  1. **No custom Etsy API integration.** No Etsy credentials, calls, OAuth, or webhooks in anything we ship. No dependency on, or
     reference to, ExportYourStore or Nembol in shipped code. `npm run guard` fails the build if either appears.
  2. **WooCommerce is the single source of truth** for the website's products, prices, variations, and order data. The storefront
     reads it read-only through the standard REST API (Step 2) and relies only on standard WooCommerce data plus metadata we own
     (`_kcpw_*`). Marketplace-style attributes are a display hint (configurable), never a requirement.
  3. **`kcpw-etsy` is withdrawn and removed** from the tree (built read-only on 2026-10-14 and never installed; recoverable from git history
     at `29cc10f`). ADR-003, ADR-004, ADR-010, ADR-013 are withdrawn or superseded; `docs/ETSY-INTEGRATION.md` is now a short note.
  4. **Priority: complete the buying path.** Product integration (done in Step 2), personalization, cart handoff, and Stripe checkout
     (ADR-002), delivered by a new first-party plugin, **`kcpw-core`**, plus the storefront's handoff route.
  5. **Checkout stays off by default**, switched on only by an operator in a staging container's environment, impossible in a production
     build, and the owner's standing instruction ("keep checkout disabled until integration testing is complete") still governs when.
- **Consequences.** Switching sync services needs no storefront change, but WooCommerce data quality is the service's job: if a service changes
  product IDs or slugs, saved carts and personalization setups break (docs/SYNC-INDEPENDENCE.md has the checklist). We cannot test either
  service from here. The one thing in WooCommerce that we write is our own personalization meta, which a sync service might overwrite;
  the setup can be copied out as JSON.
- **Alternatives considered.** Keeping our own Etsy plugin (rejected by the owner); coupling the storefront to one service's data model
  (rejected: that is the lock-in the owner wants to avoid).

### ADR-013 — Etsy is the master product catalog (Superseded by ADR-014 the same day)

> Superseded: the owner chose a third-party sync service instead. The text below is kept for the record only; nothing in it is built or planned.


- **Context.** The first plan (ADR-005) made WooCommerce the master and imported Etsy data once. The owner decided otherwise: products are
  created and edited **on Etsy**, and WooCommerce (which supplies the Next.js storefront) follows. The WooCommerce catalog already holds
  duplicate imports (INVENTORY.md: 15 title groups, 12 with two or more published copies), so linking has to come before any sync.
- **Decision.**
  1. Data flow: **Etsy -> `kcpw-etsy` (WordPress plugin, background jobs) -> WooCommerce -> Next.js**. Next.js never calls Etsy, and no customer request
     triggers an Etsy call (hard rule 4, enforced by `npm run guard`). WooCommerce keeps checkout, shipping, tax, and the official Stripe plugin.
  2. Etsy is the source of truth for **title, description, images, variations, colors, and base prices**. WooCommerce owns what Etsy has no concept of:
     the website address (slug) and SEO fields, categories and tags, shipping classes/rules, tax class, the personalization schema, the inventory policy,
     the website price when a price policy says so, and any **approved override** (a per-field, per-product decision that survives later syncs).
  3. Mappings are permanent and by ID: Etsy listing ID <-> WooCommerce product ID, Etsy inventory product ID <-> WooCommerce variation ID (SKU only as a
     matching aid where unique on both sides). **Titles are never a key.**
  4. No duplicates: before anything is created, a **matching report** lists every Etsy listing with its candidate WooCommerce products and the evidence;
     each ambiguous match needs the owner's decision (link, ignore, create new). Unmatched listings become **drafts**, never published automatically.
  5. Sync is **approved-fields-only, previewed, dry-run first, conflict-aware, and reversible** (three-way hash conflict detection, a stored plan with a
     hash, a change log with prior values for rollback).
  6. Etsy personalization settings are mapped to the storefront's structured option fields; each selection is saved on its WooCommerce order item
     (ADR-007 invariants unchanged). The mapping is a *suggestion* until the owner approves it.
  7. Price policies per product: Etsy price as is, markup percent, fixed delta, or a fixed website price. Integer cents only.
  8. Inventory policies per product: `made_to_order` (default; Etsy quantity is ignored so printable items are never marked out of stock),
     `etsy_quantity`, `woo_managed`.
  9. Scheduled background sync with Etsy webhooks as a hint where available (polling remains the recovery path, ADR-010). An admin screen shows connection
     status, last run, matches, newly imported listings, failures, and a manual sync button.
  10. The existing live WooCommerce site stays **unchanged** until the owner approves the first synchronization. The plugin contains **no WooCommerce write
      code** today (a test scans for it), and installing it on the live site is itself a change that needs approval; install on staging first.
- **Supersedes.** ADR-005 (WooCommerce-owned fields, import-once defaults). Parts of ETSY-INTEGRATION that described WooCommerce as master or Etsy publishing
  from WooCommerce (old W3/W4) are replaced; the order-import design (ADR-004, ADR-010) is unchanged and still comes later.
- **Consequences.**
  - Website copy and photos are edited on Etsy. A WooCommerce-side edit to an Etsy-owned field is a conflict (or an approved override), not a silent win.
  - Etsy's data model (two variation properties per listing, quantity per offering, listing states) leaks into WooCommerce; the planner flags structure it
    cannot represent instead of guessing.
  - Etsy's API terms, rate limits, and field shapes are **unverified here** (the sandbox cannot reach Etsy); the plugin's *Test connection* compares real
    responses with the expected shapes and names every difference, and nothing is applied before that has been run against the real shop.
  - The storefront still reads only WooCommerce, so Etsy outages and rate limits cannot affect shoppers.
- **Alternatives considered.** Next.js reading Etsy directly (breaks checkout/shipping/tax ownership and puts Etsy in the request path); a separate Node
  worker (no transactions, own queue and admin); keeping WooCommerce master with import-once (the previous plan, rejected by the owner).
- **Reversal.** The plugin can be deactivated at any time; WooCommerce keeps whatever was last approved. Per-run rollback restores prior values.

### ADR-007 — Personalization options (Pending discovery)

- **Context.** The first draft proposed a first-party option schema. The owner asked that the installed plugins be
  inspected first and that uploads not be assumed.
- **Evidence so far (2026-10-13).** The product export has no add-on or product-field plugin meta (only Facebook for
  WooCommerce). Product text describes personalization as a text box (#889 bag tag, #698 keychain) or as "message us"
  (#89, #553, #863). This does not prove the website has no personalization (plugins can keep data outside product
  meta) and the wording may be copied from Etsy. No customer image uploads are indicated. An order sample is the
  deciding input.
- **Decision.** **None yet.** The storefront DTO uses a plugin-agnostic option schema so design and the product
  page can proceed. Choose between (A) keep the existing plugin with adapters, (B) migrate to a first-party
  schema, or (C) hybrid, using the criteria in LIVE-SITE-DISCOVERY §2.1.
- **Invariants regardless of the choice.** Server-side validation and pricing; each personalization becomes its
  own order line item; readable item meta plus a normalized `_kcpw_personalization` record; all existing
  variations preserved and proven by a parity report; no upload feature unless existing products already use it.

**Update 2026-10-13 (plugin list received).** No add-on plugin is installed and none of the 61 custom plugins handles personalization,
so option (A) would add a new dependency rather than adapt an existing one. Recommendation: (B) a first-party module that stores each
cart line's options on the order item, validated by the same rules the storefront uses (33 shared vectors in
`packages/contracts/test/vectors/options.json`). Open: curated icon list versus free emoji, cable colors, order sample.

### ADR-012 — Docker deployment of the storefront (Implemented)

- **Decision.** Multi-stage `Dockerfile` (Next.js standalone output, node:22-bookworm-slim, non-root). GitHub Actions builds the image, runs
  `scripts/docker-smoke.sh` against it, and pushes **that same image** to `ghcr.io/<owner>/kcprintworks-nextjs` with `sha-<7>`, branch, `latest`
  (default branch), and version tags. The workflow has `contents: read` and, for the publish job only, `packages: write`, using the built-in token.
  The VPS runs `deploy/docker-compose.yml`: container `kcprintworks-nextjs`, external network `proxy`, `expose: 3000` and no `ports:`.
- **Staging by default.** `SITE_ENV`, `NEXT_PUBLIC_SITE_URL`, and `IMAGE_HOSTS` are build-time: `next.config.ts` writes them into the build, so an image is
  either staging (noindex) or production whatever the container's environment says (CI starts a staging image with `SITE_ENV=production` and checks it is still
  noindex). A production image is a manual workflow run. Checkout is a compile-time constant, not an environment setting.
- **Rendering (2026-10-14).** Pages are rendered per request because the catalog is read from WooCommerce at run time; a product saved in WooCommerce must not
  wait for an image rebuild. The only runtime settings are the catalog source and the WooCommerce read-only key, supplied by the VPS `.env`.
- **Rollback.** Pin an explicit `IMAGE_TAG`; `deploy.sh` waits for the health check and restores the previous tag automatically if the new one is unhealthy;
  `--rollback` or a named tag restores an earlier version without a rebuild.
- **Alternatives.** Build on the VPS (1 CPU, 4 GB: slow and risky), Vercel (the owner chose the VPS), a runtime-selectable noindex via middleware
  (more moving parts; the build-time default fails safe).
- **Consequences.** Needs a GHCR login on the VPS (or a public package), an amd64 host, and a separate production build when going live.

### ADR-008 — Catalog delivery to Next.js (Revised: Step 2 built)

**Update 2026-10-14.** Step 2 reads the **WooCommerce REST API v3** directly, server-side only, with a **Read-only** key kept in the VPS `.env` (never in the image
or the browser). Only `GET` requests exist in the client. The whole catalog (about 66 products) is loaded into an in-process stale-while-revalidate cache:
shoppers are answered from memory, a background refresh runs every `CATALOG_REVALIDATE_SECONDS` (default 120), and a signed `POST /api/revalidate/` (WooCommerce
webhook or script) makes the very next view wait for fresh data. A failing WooCommerce never empties the shop (last good copy is served). Details and the freshness
check: [WOOCOMMERCE-CATALOG.md](WOOCOMMERCE-CATALOG.md). The purpose-built DTO endpoints below remain the target once `kcpw-core` exists
(they would also carry the personalization schema and the Etsy-derived fields); the storefront's `CatalogSource` interface does not change.

Original proposal:

- **Decision.** Purpose-built read endpoints returning a denormalized DTO; the storefront has no WooCommerce
  credentials; tag-based revalidation with a time-based fallback.
- **Alternatives.** WooCommerce REST (N+1 calls for variations, needs credentials), Store API (cart-oriented),
  WPGraphQL (extra stack).
- **Consequences.** We maintain a small API and its contract tests; in return the public data shape is controlled
  and Etsy data cannot leak into it.

### ADR-009 — Migration: clone, then cut over (Proposed)

- **Context.** The live WooCommerce store runs at the apex on shared hosting and must stay operational during
  development. The target puts Next.js on the apex.
- **Decision.** Build and test on a staging clone; create the `shop.` host from a fresh clone; at cutover, freeze
  orders briefly, copy the final database to `shop.`, then repoint the apex. The old install is quarantined, not
  deleted, for 30 days. Full plan in MIGRATION-SHOP-DOMAIN.md.
- **Consequences.** A short order freeze at cutover; DNS, SSL, and Stripe changes each need approval; shared-
  hosting limits are a project risk (R15).

### ADR-010 — `order.paid` webhook with polling recovery (Withdrawn by ADR-014)

> Withdrawn 2026-10-14. Kept for the record.


- **Context.** The owner reports webhooks are available beyond commercial-only apps. Payloads are thin and early
  reports mention missed deliveries.
- **Decision.** Webhook triggers an idempotent receipt import (fast path); polling continues as the recovery
  path with an adaptive cadence; a daily reconciliation checks every receipt has exactly one order. The webhook
  handler verifies the signature over the raw body, dedupes by `webhook-id`, never fetches the payload's URL as
  given (SSRF guard), and responds quickly (ETSY §10.5).
- **Consequences.** Faster order visibility with no loss of correctness if webhooks fail; one more public
  endpoint that must pass the host's WAF.

### ADR-011 — Accessible colors on the unchanged brand palette (Approved)

- **Decision.** Keep `#F3EBDD`, `#111216`, `#FF4A24`, `#2B59E6` exactly. Adjust only **how they are paired**:
  dark text on orange buttons (5.58:1) instead of white (3.36:1); ink borders and focus rings instead of orange;
  blue links with underlines on cream; cream or orange (not blue) for links on the dark footer. Contrast ratios
  are asserted by an automated test in the storefront package (ARCHITECTURE §10).
- **Consequences.** Any new color pairing must pass the test before it ships.

### ADR-016 — Navigation, merchandising, and WordPress-managed content (Approved by the owner 2026-10-14, implemented)

- **Context.** The owner chose the header Shop | Game Cases | Personalized Gifts | New Arrivals | Blog | Cart, supplied and verified the real
  WooCommerce categories (Game Cases 417 with child Card Games 332; Personalized Gifts 418; New Arrivals 324 and Uncategorized 15 kept out of
  browsing), and asked for a Featured section, a New Arrivals section, a blog, an Our Story page and a Contact page, all managed in WordPress
  and WooCommerce. The owner manages categories and assignments by hand; the storefront must not create, rename, move, or assign any.
- **Decision.**
  - Categories are read as a tree by **id**. A parent's page lists its descendants' products once each; a parent with only children's
    products is kept; hidden slugs (`uncategorized`, `new-arrivals`) are configurable. A WooCommerce URL with a parent in it is a redirect to the
    flat canonical address.
  - The header's two category links are **settings** (`NAV_GAME_CASES`, `NAV_PERSONALIZED_GIFTS`: slug or id), read per request, so a change
    needs `docker compose up -d` and never a rebuild. A category that does not exist leaves its link out and is reported in
    `/api/catalog-status/`; nothing is guessed or created.
  - **Featured** is WooCommerce's own star, ordered by manual order then newest, at most 8; with none starred the section is not drawn (never
    padded). **New Arrivals** is ordered strictly by publication date and never uses the New Arrivals category.
  - The blog, Our Story, and Contact are read from the WordPress REST API (public, GET only, no credential). HTML from WordPress is treated as
    untrusted: a strict allowlist sanitizer (`lib/wp/sanitize.ts`), YouTube (privacy-enhanced domain) and Vimeo embeds only, sandboxed frames,
    prefixed ids, WordPress block classes only, links to known posts/pages rewritten to the storefront. Answers are cached with
    stale-while-revalidate, a remembered failure (no visitor waits out a timeout), and a size cap; slugs WordPress never listed are never asked
    about. The signed `/api/revalidate/` refreshes this content too. Sections that are a nicety wait at most 2.5 s on the home page.
  - No text is invented: a missing Our Story or Contact page says "coming soon" and is kept out of search results.
- **Alternatives.** A custom WordPress read-API plugin (more to maintain; the public REST API is enough); client-side fetching (slower, leaks the
  WordPress address, no SEO); hard-coding header category ids (breaks if an id changes; a rebuild per change).
- **Consequences.** The blog needs the WordPress REST API to be public; "disable REST API" plugins break it. Posts exist on two hosts, so the
  WordPress copy should be noindex (owner's setting). Unverified here: behavior against the live WordPress (docs/WORDPRESS-CONTENT-AND-REVIEWS.md §9).

### ADR-017 — Customer reviews: real, approved, and moderated (Approved by the owner 2026-10-14, implemented; writing is off by default)

- **Decision.**
  - **Display** uses only what WooCommerce publishes: its own average and count per product, and the approved reviews from the public Store API
    (no credential, no email). Only whole 1-5 ratings with text are shown. Names are shortened ("Jane D."; an email-like name becomes "Customer").
    "Verified purchase" only when WooCommerce says so. No store-wide rating and no invented review exist anywhere. Structured data (Product
    aggregateRating and Review) is built from the same real values.
  - **Submission** goes browser -> the storefront's own `/api/reviews/` -> `kcpw-core` 0.2.0 (signed, server to server) -> a **pending** WordPress
    review. Nothing is published automatically, whatever the Discussion settings say. The browser never holds a credential, and a request cannot
    carry "verified", "approved", or a status (refused as unknown fields; the shared vectors prove the storefront and the plugin agree on the rules).
    "Verified" is WooCommerce's own call from the email. WooCommerce's "only verified owners" setting is respected. One review per email per product;
    a repeat looks exactly like a first (no way to learn which emails reviewed what).
  - **Spam and abuse**: same-site check, JSON only, 8 KB, a signed form token (3 s to 2 h old, bound to the product), a hidden field, no links in
    the text, limits per visitor / per email / overall (storefront and plugin), invisible/bidi characters refused.
  - **Privacy**: the email goes only to WordPress; the visitor's address is only ever a keyed hash; submissions are not logged.
  - **Off by default** (`REVIEWS_SUBMIT_ENABLED`): it needs the plugin update on the shop site, which is a change to that site (staging first).
  - **Etsy reviews** are not shown and not scraped. If the owner's sync tool already imported reviews they are ordinary approved reviews; the
    discovery queries are in docs/WORDPRESS-CONTENT-AND-REVIEWS.md §5. A source label is added only from real data, on request.
- **Consequences.** Unverified here: the plugin's behavior inside a real WordPress/WooCommerce (comment pipeline, verified meta, moderation email);
  docs/REVIEWS-STAGING-CHECKLIST.md proves it, and never approves a test review.

### ADR-018 — Production checkout, with a guard that keeps staging away from real payments (Owner request 2026-10-14, implemented)

- **Context.** ADR-002's build made checkout impossible in a production build (a deliberate safety while Stripe was unproven). The owner now has a production
  storefront ready and asked for real checkout, without removing any checkout security. Staging (`dev.kcprintworks.com`) and production (`kcprintworks.com`) share one
  WooCommerce/Stripe site (`shop.kcprintworks.com`), and the storefront's address is baked into each image.
- **Decision.**
  1. The "never in production" rule is replaced by validation. Checkout is **off by default** in every build. A production build turns it on only with
     `CHECKOUT_ENABLED=true`, an https shop address (no local exception), a 32+ character handoff secret, `CATALOG_SOURCE=woo`, and an https, non-local,
     path-free storefront address baked into the image that is not the shop's host. Missing settings leave it off and are named (never their values).
  2. Everything that protects the handoff is unchanged: HMAC-signed requests with timestamp and nonce, replay protection, single-use hashed 10-minute links, the
     redirect pinned to the shop's origin and one 43-character token, strict bodies with no prices, and a local re-quote before the shop is asked.
  3. A **shop guard** runs on every checkout press (signed `GET /status`, no caching). A non-production build proceeds only if the shop positively reports Stripe in
     **test** mode (live, unknown, or unreachable are refusals), so when the shared shop goes live a forgotten switch on staging cannot charge cards. A production
     build proceeds only if the shop's reported `storefrontUrl` (kcpw-core 0.2.1) has the same origin as the image's address; a shop that does not report one
     (0.2.0) is allowed but flagged in `/api/checkout-status/`, because it only changes where an error sends the shopper.
  4. Production is a **separate image** (`...-production`, built by the manual workflow with `site_url`, default `https://kcprintworks.com`) and a **separate
     container** from its own directory using `docker-compose.production.yml`, which extends the staging definition and renames the project, service and container
     (a shared service name is a shared DNS alias on the `proxy` network). `deploy.sh` keeps the two apart (`DEPLOY_KIND`).
  5. `KCPW_STOREFRONT_URL` on the shop must name the production storefront at go-live (one shop, one value).
- **Alternatives rejected.** Keeping production checkout a code change per release (the request); letting a runtime `SITE_ENV` pick the rules (a staging image could
  then be made "production"); making staging safe only by documentation (one forgotten `.env` line would charge cards); one container serving both hosts (the baked-in
  address and indexing behavior differ).
- **Consequences.** Staging checkout stops working by itself once Stripe is live (use test mode for staging tests or take a staging copy of the shop). Unverified here:
  the real WordPress/WooCommerce/Stripe chain and the order-received page on the shop host; [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md) §6 proves it.

### ADR-019 — Checkout styling plugin (Owner request 2026-10-14, built)

- **Context.** The Next.js storefront has a designed look; WooCommerce's checkout (Checkout Block on the Astra theme, page ID 9, on `shop.kcprintworks.com`) did not: a tall theme header with an outdated logo, an old blue promo banner, the theme's colors.
  The cart hands off to this page through `kcpw-core`, and payments are the official Stripe and PayPal plugins. The owner asked for visual consistency without touching payments, shipping, tax, fields, orders or personalization.
- **Decision.**
  1. A **separate** plugin, `wordpress/kcpw-checkout-style`, not part of `kcpw-core` (whose job is the handoff, personalization and reviews): styling can be installed, previewed, switched off and removed without any risk to the buying path.
  2. It acts on one page only. A body class (`kcpw-checkout`), one stylesheet, one inline rule and a compact header are added there; every selector is scoped to that class. It registers no route, AJAX action, redirect or script and reads or writes no cart, order or option.
  3. The theme's header is hidden **together with** the printing of the compact header (so a theme that never prints it keeps its own header), along with WooCommerce's store notice; further elements can be hidden with a validated wp-config setting that **refuses** anything naming the checkout, a field, a button or a payment method.
  4. Payment is protected by construction: rules aimed at payment methods set only color, border color and radius; no rule mentions a frame; layout stays WooCommerce's (container queries). Tests enforce each of these and a browser test compares the payment container's computed geometry with and without the stylesheet.
  5. The logo is the storefront's own: it is a "KC" mark and a name drawn in HTML and CSS (there is no logo image in the repository), so the plugin draws the same and loads no image. The old WordPress logo (attachment 313) is not used on this page and is not touched.
  6. Rollout and rollback are part of the design: `KCPW_CHECKOUT_STYLE` = `on` | `admins` (preview) | `off`; a typo counts as `off`; the plugin stores nothing in the database.
  7. WooCommerce's own "Return to Cart" link is hidden because it leads to WooCommerce's cart page, which is not part of the journey; the header's link goes to the storefront's cart.
- **Alternatives rejected.** Editing Astra or its child theme (breaks on update, wider blast radius); adding the CSS through the Customizer's "Additional CSS" (not versioned, not testable, no scoping, no header); rebuilding the checkout in Next.js (the owner's hybrid checkout decision, ADR-002, keeps payment on WooCommerce).
- **Consequences.** Unverified here: the real Astra and WooCommerce markup and Stripe/PayPal elements (the sandbox reaches none of them); the class names come from the open source of WooCommerce Blocks as published on npm (unconfirmed origin) and Astra's from memory. The first look is therefore the owner's preview step, and the stylesheet may need small selector adjustments after it.

### ADR-020 — Address autocomplete plugin: original, staged, preview-first, optional features off (Owner request 2026-10-15, built)

- **Context.** The owner asked for a WordPress address-autocomplete plugin that works with a free Google API key and carries the useful Free and "Pro" features of a commercial plugin they described, **without a paid licence and without copying anyone's code, branding or assets**; with the WooCommerce Checkout Block (correct React updates, shipping rates, Stripe) as the first priority; an administrators-only preview; session tokens and debounced requests to keep Google costs down; a Visual Selector Tool; no complete customer addresses in analytics; no webhook, abandonment tracking or IP-based location without an explicit opt-in; Google's terms respected; automated tests; an installable ZIP; and **nothing deployed or activated on the live shop**, adding features in stages rather than risking the live checkout.
- **Decision.**
  1. A **new, standalone plugin** `wordpress/kcpw-address-autocomplete` (0.1.0), original code under GPL-2.0-or-later; not part of `kcpw-core` (handoff, personalization, reviews) or `kcpw-checkout-style` (styling), so it can be installed, previewed, switched off and removed on its own. It depends on neither, and not on any Etsy or sync service (the repository guard covers it).
  2. **Three modes, Preview by default.** Off loads nothing; Preview gives the plugin to signed-in administrators only (the page, the scripts and every REST route); Live gives it to everyone. A fresh install has no key and no feature on. Going Live is a deliberate click with a confirmation.
  3. **The core is small and lazy:** one script (about 17.8 KB gzipped) and one stylesheet, only on pages that match a configured form; Google's script is requested only when a visitor first focuses an address field. Everything else is a separate optional file (PO box notice, address check, "use my location", map), downloaded only when that feature is on and a form on the page uses it, and the two tool buttons fetch their code only on a click.
  4. **React-safe filling is the core behavior** (one field at a time, native setter plus real events, country then settle, re-find fields after a redraw, read-back and retry, the payment area never touched), proven against a Checkout Block stand-in written with real React and a shared store read by a stand-in shipping-rates calculation.
  5. **Cost control by design:** one session token per typing session, a 300 ms pause, 3 characters, an in-memory cache, a per-session request cap, a stop after any failure, only the cheapest field set after a choice, a daily ceiling and a verdict cache for the address check, a lookup cap on the map. The owner is told to set Google-side quotas and budget alerts: the plugin's own limits are a courtesy.
  6. **Privacy by default.** The usage counters are whole numbers from a fixed list; a browser cannot report address checks or checkouts (the server counts those). Nothing about a customer is stored. The webhook (consent + https; no address unless a separate box is ticked), checkout counting (two numbers; Live only) and the location hint (a country from a CDN header, or a lookup service the owner names; soft ranking only) are each **opt-in and off**, each its own switch with its state shown.
  7. **Two Google keys.** A website-restricted browser key for the visitor-side services; a separate IP-restricted **server key** for the Address Validation API, never sent to a browser and never printed back (last four characters only). Either can live in `wp-config.php` instead of the database.
  8. **PO box refusal is the only feature that can refuse an order**, and so it is the most guarded: off unless the owner picks "refuse", Live only, PO boxes only (never military addresses), and any error inside the check lets the order through. Everything else is advice.
  9. **Deliberately not built:** a public autocomplete proxy (would let strangers spend the owner's Google quota), saved addresses (stores customer addresses), white label, an Elementor widget (the preset and the shortcode cover it), and a commercial plugin's support links.
- **Alternatives rejected.** Extending `kcpw-core` (couples an optional convenience to the buying path); a paid or third-party plugin (the owner asked for no licence and original code); wrapping Google's own `places.Autocomplete` widget (it draws its own dropdown, which cannot be made to fill React-controlled fields correctly or be styled to the accessibility target, and Google now steers new projects to Places API (New): check its current guidance); one big script (every checkout would download features it does not use).
- **Consequences.** Unverified here, because this sandbox reaches none of them: a real Google project and key, a real WordPress and WooCommerce (and the Checkout Block's markup in the owner's release), a real Stripe payment, the selectors of the seven non-WooCommerce form-plugin presets, PO box refusal on a real checkout, browsers other than Chromium, and screen readers. [docs/ADDRESS-AUTOCOMPLETE.md](ADDRESS-AUTOCOMPLETE.md) §4 is the owner's staging checklist that proves them, and the staged rollout in §2 is how the plugin is brought to the live checkout without risking it. Google's terms and prices can change; the docs name the APIs and the billing requirement but quote no price.

### ADR-021 — Custom quotes: a separate plugin, a secret expiring link, one order per approval, a payment check that compares the order with what was approved (Owner request 2026-10-15, built)

- **Context.** The owner wants customers to ask for custom work without paying, to price and email each quote from WordPress, and to let the customer approve it through a secure expiring link and pay the approved amount through WooCommerce and the official Stripe plugin, with the order tied to the quote. Required: no price manipulation, no reused links, no duplicate orders or payments, no unauthorized access, HPOS support, secure uploads, spam protection and rate limits, private customer data, **no change to normal checkout**, and nothing deployed, activated, or changed on the live shop, VPS, Stripe or DNS without approval.
- **Decision.**
  1. A **new standalone plugin** `wordpress/kcpw-quotes` (0.1.0, GPL-2.0-or-later), not an extension of `kcpw-core` (handoff, personalization, reviews): it owns four tables of its own and an admin area, and can be installed, deactivated and removed without touching the buying path. It uses the same signed server-to-server scheme and `KCPW_HANDOFF_SECRET` as `kcpw-core` (a copy of the small signing/verification classes, so neither plugin needs the other), and adds no payment code.
  2. **The storefront stores nothing.** `/custom-orders/` (request form), `/custom-orders/quote/` (the private page) and two API routes validate with the same rules as the plugin (TypeScript is the reference; generated vectors in `packages/contracts/test/vectors/quotes.json` are run by PHP), then call the plugin. Taking requests is `QUOTES_ENABLED` (default **off**). **Approving and paying a quote is checkout**, so it also requires `CHECKOUT_ENABLED` and the same per-press shop guard as the cart (ADR-018): a staging build never reaches a shop in live Stripe mode, a production build never hands a shopper to a shop that returns them elsewhere. Quotes alone never turn payments on.
  3. **A request can never carry a price, a status or an order.** Bodies are strict; unknown fields are refused. Prices exist only in the dashboard, as whole cents.
  4. **The link.** 256-bit random token, only its SHA-256 stored, constant-time comparison, the same answer for a wrong reference and a wrong token. Each (re)send makes a new token (the old link dies), withdrawing/declining/cancelling clears it, expiry is checked on every use. The page is `noindex`, never cached, `no-referrer`. The token is in the URL (an email link has nowhere else to carry it): server logs in front of the app may record it, which is why it expires and rotates.
  5. **Every state change is a compare-and-swap** (`UPDATE … WHERE status IN (…) AND revision = …`), so a double click, two tabs, a retry, the cron job and a payment notice can never both win. The approval counts only for the revision the customer saw.
  6. **One order per approved quote.** After the swap to Approved the order is created under a short lease, after looking for an existing order that carries the quote's id (crash recovery), as a pending guest order with one fee line (the item) and one shipping line, through WooCommerce's CRUD objects only (HPOS-safe). Amounts come from the stored quote, never from the request. A keyed fingerprint (quote, revision, both amounts, currency, tax treatment, email) is written on the order.
  7. **Payment is verified, not trusted.** WooCommerce is told a quote order needs no payment unless its quote is Approved, in time, unchanged, and its lines still match (so a changed order cannot be paid); and when an order becomes Processing/Completed the quote becomes Paid only if the order matches the fingerprint, the amounts, the currency and has no extra lines. Anything else is flagged for a person with an order note and an email, never silently counted. Money received for a quote that was cancelled meanwhile is never hidden.
  8. **Normal checkout is untouched:** three WooCommerce hooks (`order_status_changed`, `cancel_unpaid_order`, `order_needs_payment`), each a no-op for an order without `_kcpw_quote_id`. The shipping on a quote order is the amount the owner quoted, not WooCommerce's zones. Tax is **off** unless `KCPW_QUOTES_TAXABLE` is set.
  9. **Uploads:** type decided by bytes, count/size/pixel caps checked from the header, re-drawn with GD (appended code and metadata dropped), stored under random names without extension in a deny-all folder (or `KCPW_QUOTES_UPLOAD_DIR` outside the web root), served only by a nonce-checked, capability-checked handler with `nosniff` and a sandboxing CSP.
  10. **Privacy and operations:** WordPress Export/Erase tools supported; finished requests are erasable, live ones are not; the dashboard has a Setup check; uninstall keeps all data unless an explicit constant says otherwise.
- **Alternatives rejected.** Extending `kcpw-core` (couples an optional feature to checkout); storing requests in the storefront (the storefront has no database and must not hold customer data or pictures); creating a WooCommerce product or draft order per quote (touches the catalog and fills it with one-off products; the order-with-a-fee-line approach touches neither); a coupon or price override on a generic product (a price the browser could influence); a payment link made by Stripe directly (would bypass WooCommerce as the single source of truth for orders and the owner's existing Stripe setup); trusting the payment gateway's callback without comparing the order (an edited order would be counted as paid).
- **Consequences.** Unverified here, because this sandbox reaches none of them: real WordPress/WooCommerce (order creation, the "Pay for order" page for a guest, HPOS, tax), the official Stripe plugin and its webhooks, mail delivery, a real MySQL (the SQL runs on SQLite in tests; MySQL's changed-row semantics are handled by never swapping to identical values), and the owner's server limits (`post_max_size`, firewalls). [CUSTOM-QUOTES.md](CUSTOM-QUOTES.md) §7 is the staging checklist that proves them. Known gaps: a payment that completes at the instant the plugin cancels an unpaid order (flagged for refund, rare); one shop has one `KCPW_STOREFRONT_URL`, so emailed links open the storefront that value names (documented for staging versus production).

### ADR-022 — Product search from the catalog already in memory (Owner request 2026-10-15, built)

- **Context.** The owner asked for header search (icon beside Cart, live results with image/name/price/category, typo tolerance, keyboard and screen-reader support, a results page with category filters) over published, catalog-visible products only, with no paid service and no extra WordPress or WooCommerce requests, and with edits searchable after a catalog refresh.
- **Decision.** The search index is built from the catalog snapshot the storefront already caches and is memoized per snapshot (a `WeakMap` keyed by the products array), so a refresh rebuilds it with no extra code and no invalidation hook. The matcher is small and hand-written (folded words, plural folding, prefix/infix, bounded edit distance, a tabletop synonym list extendable with `SEARCH_SYNONYMS`, weighted fields, AND semantics) rather than a library. The header control is a native `<details>` + a real GET form (works without JavaScript), upgraded to an ARIA combobox with a debounced, abortable request to `/api/search/` (read-only, rate-limited). `/search/` is `noindex`. A search with no match offers the custom-quote link with the typed words as the game.
- **Alternatives rejected.** A hosted search service or a WordPress search endpoint (paid or an extra request per keystroke, and they cannot see the catalog snapshot); a fuzzy-search library (more JavaScript than the whole feature); indexing in the browser (ships the whole catalog to every visitor); searching drafts or hidden products "for staff" (never reachable from the public catalog copy).
- **Consequences.** Search follows the catalog's freshness exactly (`CATALOG_REVALIDATE_SECONDS` or the signed refresh). The synonym list is a starting list of tabletop shorthand, not a claim about the owner's catalog. Verified by unit, browser and accessibility tests on synthetic data; the real catalog's behavior is the owner's first look.
