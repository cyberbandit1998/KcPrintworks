# Decisions and Open Inputs

Last updated 2026-10-14. Etsy is now the master product catalog (ADR-013); the storefront reads WooCommerce read-only (ADR-008, revised).

## 1. Decision status

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | Domain topology: Next.js at `kcprintworks.com`; WordPress/WooCommerce (admin, checkout, REST, webhooks) at `shop.kcprintworks.com` | **Approved** 2026-10-13 |
| ADR-002 | Hybrid checkout: Next.js storefront and cart; WooCommerce-hosted checkout with the **official** Stripe plugin; secure single-use cart handoff | **Approved** 2026-10-13 |
| ADR-003 | Etsy sync is a separate WooCommerce plugin (`kcpw-etsy`) | **Approved** 2026-10-13. Revised 2026-10-14: now the product **source** pipeline (ADR-013); read-only preview built, no WooCommerce writes yet |
| ADR-004 | Etsy orders imported as WooCommerce orders marked "Paid on Etsy" | Proposed (not yet explicitly approved; implicit in the approved plan) |
| ADR-005 | WooCommerce owns the website; per-field ownership; import-once defaults; Woo-owned SEO | **Superseded 2026-10-14 by ADR-013** (the owner chose Etsy as master) |
| ADR-006 | Etsy access class: **Seller App / Seller API Access**, read-only scopes first | **Revised 2026-10-13** (was "personal access"). 2026-10-14: scopes `shops_r` + `listings_r` now; `transactions_r` only with order import; still no write scope |
| ADR-007 | Personalization solution | **Recommended: first-party `kcpw-core` module** (no plugin exists to adapt; see [PERSONALIZATION.md](PERSONALIZATION.md)). Awaiting owner approval, icons decision, and an order sample |
| ADR-008 | Catalog delivery to Next.js | **Revised 2026-10-14, Step 2 built:** the storefront reads the WooCommerce REST API (GET only, read-only key, in-memory stale-while-revalidate cache, signed refresh endpoint). Purpose-built DTO endpoints stay a later optimization |
| ADR-009 | Migration strategy: clone then cut over; live site stays operational | **New, proposed** |
| ADR-010 | Etsy `order.paid` webhook as fast path with polling as recovery | **New, proposed** |
| ADR-011 | Accessible foreground colors on the unchanged brand palette | **Approved** 2026-10-13 |
| ADR-012 | Storefront runs as a Docker image published to GHCR; staging by default; rollback by image tag | **Implemented**, owner requested 2026-10-13. Revised 2026-10-14: pages are rendered per request; noindex and image hosts are still fixed at build |
| ADR-013 | **Etsy is the master product catalog**; Etsy → `kcpw-etsy` → WooCommerce → Next.js; permanent ID mappings; no duplicates; preview, dry-run, rollback; WooCommerce keeps checkout, shipping, tax, Stripe | **Owner decision 2026-10-14.** Read-only connection and preview built; **nothing is written to WooCommerce until the owner approves the first synchronization** |

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
8. **Etsy:** whether a developer app is already registered, listing count, price rule (independent assumed),
   buyer email (excluded by default).
9. **Etsy Seller App (new, blocks the first real connection):** register the app under your Etsy account, add its redirect
   address, and put the API key in `wp-config.php` of the **staging** WordPress ([ETSY-SETUP.md](ETSY-SETUP.md)). Until then the
   plugin has only been tested against mock Etsy responses.
10. **WooCommerce read-only REST key (new, blocks Step 2 on the real catalog):** you create it (Read permission) and put it only in the
    VPS `.env` ([DEPLOYMENT-VPS.md](DEPLOYMENT-VPS.md) section 9).
11. **Network access for verification work:** allow `developers.etsy.com`, `developer.etsy.com`,
   `help.etsy.com`, and `mcp.api.etsycloud.com` (plus `kcprintworks.com` if you want me to inspect public
   pages) in the environment's network settings, or run the discovery yourself.
   See <https://code.claude.com/docs/en/cloud-environments#network-access>.

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

### ADR-003 — Etsy sync as a separate WooCommerce plugin (Approved)

- **Context.** Needs: direct WooCommerce CRUD, transactions, a job queue, retries, WP admin authorization, and
  strict isolation from shoppers.
- **Decision.** `kcpw-etsy` plugin using Action Scheduler, driven by cron, separate from `kcpw-core`.
- **Alternatives.** A separate Node worker: type-sharing with Next.js and process isolation, but it needs its
  own queue, state, and authenticated admin, and would write to WooCommerce through REST without transactions.
- **Consequences.** Sync shares the WordPress host with checkout, so load is managed with batch limits,
  concurrency 1, and a load test (R7). The plugin boundary and kill switch keep it removable. Shared hosting
  may make this harder (MIGRATION §10).

### ADR-004 — Etsy orders as WooCommerce orders (Proposed)

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

### ADR-006 — Etsy access class and scopes (Revised)

- **Context.** The owner reports that Etsy introduced Seller API Access in July 2026 for sellers connecting their
  own shops. Excerpts of Etsy's help center agree: a Seller App covers the registered shop only, cannot serve
  other sellers, and approval is typically quick. I could not open Etsy's pages, so details remain to be verified.
- **Decision.** Register a **Seller App**; do not apply for Commercial Access. Scopes `shops_r`, `listings_r`,
  `transactions_r` only until a write feature is approved; no `listings_d`; `email_r` off by default.
- **Consequences.** Replaces the earlier "personal access" plan. The app may only ever be used with this shop.
  Confirm rate limits, scope list, and the effect of any existing registered app on the real page in Step 5,
  using Etsy's Dev MCP server and the official OpenAPI spec (ETSY §2.1).

### ADR-013 — Etsy is the master product catalog (Owner decision 2026-10-14)

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

### ADR-010 — `order.paid` webhook with polling recovery (Proposed)

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
