# Project Status

Living document. Update it at the end of every session (see [CLAUDE.md](CLAUDE.md)).

- **Last updated:** 2026-10-14 (session 1, tenth part: production checkout, ADR-018; earlier the same day: after ADR-014 (**WooCommerce is the single source of truth**) the owner approved plan v2, now built: category tree and header, Featured / New Arrivals, WordPress blog + Our Story + Contact, approved reviews and moderated review writing (ADR-016, ADR-017))
- **Branch:** `claude/hopeful-hamilton-lq8pw6` (no pull request opened; owner has not asked for one)
- **Environment:** staging only. The **staging** Docker image (noindex, **checkout off**) runs on the owner's VPS; it can read the real WooCommerce catalog
  once the owner adds a Read-only key (`docs/DEPLOYMENT-VPS.md` §9). The WordPress plugin `wordpress/kcpw-core` (cart handoff + personalization) is built
  and tested with stand-ins but **not installed anywhere**. The live WooCommerce site, WordPress, MariaDB, Nginx Proxy Manager, Etsy listings, the
  owner's sync service, Stripe configuration, and DNS have **not** been touched.

## Where we are

| Phase                                                       | Status                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Architecture and plan                                       | **Approved by the owner 2026-10-13**; sync-neutral revision (ADR-014) decided 2026-10-14                  |
| Phase 0: foundations (monorepo, CI, guards)                 | **Done** except staging and local WordPress environments (blocked on discovery/hosting facts)             |
| Live-site discovery (plugins, products, personalization)    | **Partly done.** Product export analyzed (`docs/discovery/INVENTORY.md`); plugins, orders, hosting, DNS still unknown |
| Step 1: Next.js storefront design                           | **Built, awaiting owner design review (gate G1).** Default data is synthetic; `CATALOG_SOURCE=export` previews the owner's real 66 products. The owner's hero photo file is still needed |
| Step 2: WooCommerce products and variations                 | **Built, tested against a mock store, not yet run against kcprintworks.com.** Read-only REST source, cache + signed refresh, sync-neutral display policy (`docs/WOOCOMMERCE-CATALOG.md`). Needs the owner's Read-only key |
| Independence from the sync service (ADR-014)                | **Done in code and guard.** No Etsy API, credentials, or sync-product names in shipped code; the storefront reads only standard WooCommerce data plus our own `_kcpw_*` meta (`docs/SYNC-INDEPENDENCE.md`). Behavior of ExportYourStore/Nembol toward product meta and IDs is **unverified** |
| Custom Etsy plugin `kcpw-etsy`                              | **Withdrawn and removed** (built read-only earlier the same day, never installed; recoverable with `git show 29cc10f:wordpress/kcpw-etsy`) |
| Step 3a: `kcpw-core` WordPress plugin (handoff + personalization) | **Built; logic proven by shared TS/PHP vectors; WordPress/WooCommerce glue verified with stubs only.** Not installed |
| Step 3b: storefront cart handoff (`/api/cart/handoff/`)     | **Built and tested end to end against a stand-in shop.** Off by default in every build; a production build may take it only under the stricter rules of ADR-018 |
| Production checkout (ADR-018, owner request 2026-10-14)     | **Built; tested with stand-ins only; OFF by default; nothing deployed or changed on the VPS, WordPress, Stripe or DNS.** Production image (`-production` tag) + a second container (`docker-compose.production.yml`) beside staging; staging refuses a shop in live Stripe mode; production refuses a shop that returns shoppers elsewhere. Runbook [docs/CHECKOUT-PRODUCTION.md](docs/CHECKOUT-PRODUCTION.md); the real shop/Stripe chain is proven by its §6 |
| Stripe checkout (official WooCommerce plugin, test mode)    | **Nothing of ours touches payment.** Owner configures the Stripe plugin on staging; runbook `docs/CHECKOUT-STAGING-CHECKLIST.md`. Not yet run |
| Navigation, categories, Featured, New Arrivals (plan v2, ADR-016) | **Built and tested against a mock store using the owner's verified category ids/slugs.** Header Shop \| Game Cases \| Personalized Gifts \| New Arrivals \| Blog \| Cart (responsive, no-JS menu); Game Cases includes Card Games; header categories are settings; New Arrivals by publication date. **Not yet seen against the live catalog** |
| Blog, Our Story, Contact from WordPress (ADR-016)          | **Built and tested against a WordPress stand-in** (hostile markup, protected/draft posts, outages, paging, sitemap, JSON-LD). **Not yet run against the real WordPress** (checks in `docs/WORDPRESS-CONTENT-AND-REVIEWS.md` §9) |
| Customer reviews: display (ADR-017)                         | **Built; approved reviews from WooCommerce's public Store API, real ratings only.** Tested against a Store API stand-in; not yet against the real shop |
| Customer reviews: writing, moderated (ADR-017)              | **Built; OFF by default (`REVIEWS_SUBMIT_ENABLED`).** Needs `kcpw-core` 0.2.0 on the shop (not installed anywhere). Rules proven by shared TS/PHP vectors; the WordPress glue only by stubs: `docs/REVIEWS-STAGING-CHECKLIST.md` proves it |
| Deployment of the storefront (staging container, VPS)       | **Image published; owner installs it** (`docs/DEPLOYMENT-VPS.md`). Needs the owner's DNS and Nginx Proxy Manager steps |
| Step 4: personalized order + payment testing                | Not started (needs staging WordPress with `kcpw-core` and Stripe test keys)                              |
| Step 10: full integration test and launch readiness         | Not started                                                                                               |

### Approvals received (owner message, 2026-10-13)

Approved: Next.js storefront at `kcprintworks.com`; WooCommerce backend with `shop.kcprintworks.com` as the
proposed checkout/admin domain; the official WooCommerce Stripe plugin; secure single-use cart handoff; a
separate WooCommerce plugin for Etsy sync; accessible foreground colors on the unchanged brand palette.
Instructions: keep the live site operational and document the migration before moving anything; preserve all
existing WooCommerce variations with per-item personalization stored in orders; inspect installed plugins
before choosing a personalization solution; do not assume image uploads; keep Etsy read-only initially with a
preview before applying; use staging and Stripe test mode; build in phases.

### Owner decisions and instructions, 2026-10-14

**WooCommerce is the single source of truth** (ADR-014, which supersedes ADR-013 "Etsy is master"). The owner synchronizes Etsy into WooCommerce with a
third-party service (ExportYourStore now, perhaps Nembol later). The storefront must not depend on either, must need **no code change** if the service
is switched, must not call Etsy or build an Etsy integration, and must not be coupled to a sync product. Priorities: WooCommerce product integration,
personalization, cart handoff, Stripe checkout. Standing constraints still apply: do not alter the live WordPress site, DNS, or payment settings; the
live WooCommerce products and inventory stay unchanged; checkout stays disabled until integration testing is complete; no WooCommerce product is created,
updated, or deleted by us.

### Approvals **not** given (all still required)

Any DNS change (including creating `shop.` or a staging subdomain), SSL issuance on production, Stripe test or
live configuration changes (webhooks, Apple Pay domain, keys), any change to the Etsy shop or to the sync service's settings, any WooCommerce
product or inventory write by us, installing `kcpw-core` on the **live** site (staging first), creating a WooCommerce webhook, switching checkout on
anywhere, and the cutover (gate G6). Creating the WooCommerce Read-only REST key and the Stripe test keys are the owner's actions.

## What exists in the code

Verified on 2026-10-14 (after plan v2): `npm run check` (run with the gitignored export moved aside, as CI sees it) and `npm run test:e2e` pass locally: **111** contracts tests (incl. 33 shared
personalization vectors, 29 shared line-pricing vectors, **60+ shared review vectors**, 3 request-signing vectors, and a graph test that keeps zod out of the browser entry), **330** storefront unit tests
(2 more skip in CI because they read the gitignored export), **46** script tests, **98** PHP tests / 1071 assertions for `kcpw-core`, and **219** Playwright e2e tests (axe WCAG 2.2 AA on every
route including the blog, reviews and the review form, no horizontal scroll 320 to 1280 px, keyboard and focus flows, payload and script-size budgets, hostile-markup and outage tests, and the tests against a mock
WooCommerce store, a WordPress REST stand-in, a Store API stand-in and a `kcpw-core` stand-in). The Docker smoke script (`scripts/docker-smoke.sh`) also passes against a standalone build here (the Dockerfile itself is verified by the GitHub run).
Page weight (standalone build, fixtures): every page loads **472 KB of JavaScript decoded / 142 KB gzipped**, the blog and Our Story pages the same as the shop (they add none); a product page 495 KB (the bag tag with 169 variations is the same);
HTML 13 to 59 KB (7 KB gzipped on the home page); warm server responses 10 to 50 ms; WordPress, the Store API and WooCommerce are asked **0 times** for a repeat view, and 4 times for the first view of a blog post however many links it has;
the home page's hero keeps `fetchpriority=high` and every other picture is lazy.
Plan v2 image: **`sha-dfc25b6`** (CI run 38607055885 and image run 38607055710 green; digest `sha256:0854f66d2286fa6168abd90ae2b348848c49c3159fc0aed237f83d177efef9a1`; the same application code was first published as `sha-91de61d`, whose CI e2e failed only because two tests let the accessibility scan judge YouTube's own page, fixed in the tests). Rollback target: `sha-1ca27d3` (free shipping and hero banner, before plan v2).
Older images: `sha-e2d7c3a` (CI run 38559572272 and image run 38559572315 green; digest `sha256:513a9849…cff607`) and `sha-8529f95` (same code, docs only; the one deployed on staging when the checkout-config problem below was reported). The image for the checkout-config fix is the one from the next push; its tag is in that run's "Publish Docker image" summary.

- **`packages/contracts`:** integer money; plugin-agnostic personalization option schema and `validateOptions`;
  strict product DTO (rejects Etsy fields); strict cart line intents (rejects client prices); `priceLine`
  reference pricing (the oracle that the PHP side must match with shared vectors in Step 3). **Supports
  WooCommerce "Any" variations** (empty attribute value): cart lines carry the shopper's chosen `attributes`,
  `findVariation` prefers the most specific variation, and a fixed variation fills in its own values.
- **`apps/storefront`:** home, shop, category, product page (variation chips, personalization form, validation
  error summary, live item price), cart (server-quoted via `/api/cart/quote/`), 404, sitemap, robots (noindex
  unless `SITE_ENV=production`), JSON-LD, sanitized rich text, security headers. Data comes from `CatalogSource`:
  the **placeholder fixtures** (default), the design-preview export, or **`CATALOG_SOURCE=woo`** (Step 2, below). Pages are
  rendered per request. New routes: `GET /api/catalog-status/` (what is loaded, how fresh, what was skipped) and
  `POST /api/revalidate/` (HMAC-signed "refresh now", WooCommerce-webhook compatible).
- **WooCommerce catalog source (Step 2)** `apps/storefront/src/lib/catalog/woo/`: GET-only client (Basic auth in a header, https only,
  redirects refused, no write method), REST-to-DTO converter (real slugs, product and variation IDs, "Any" variations kept as is,
  sale prices, stock, categories, photos, option schema from `_kcpw_option_schema` meta or proposed fields), in-memory
  stale-while-revalidate cache with single flight, race-safe invalidation, and last-good fallback. Image optimizer limited to
  `kcprintworks.com` hosts (build-time `IMAGE_HOSTS`). `scripts/verify-catalog-freshness.mjs` proves a change appears without a rebuild.
  Tests: unit tests against `tests/support/mock-woo.mjs` (GET-only mock store, synthetic data) and a Playwright suite.
- **Sync-neutral display policy** `apps/storefront/src/lib/catalog/display-policy.ts`: marketplace-style attributes are hidden from shoppers (display only; list
  extendable with `CATALOG_HIDDEN_ATTRIBUTES`), a generic "Listed with ...com" footer is stripped by shape, and made-to-order is read from a
  tag/attribute/`_kcpw_made_to_order` meta. Nothing names a sync product; `npm run guard` fails if Etsy or a sync-service name appears in shipped code.
- **Navigation and catalog browsing (plan v2):** `lib/catalog/queries.ts` (category tree by id with descendants and hidden slugs, sort, paginate, Featured, publication-date
  New Arrivals), `lib/nav.ts` (header slots resolved per request from `NAV_*`), `components/SiteHeader.tsx` + `NavMenu.tsx` (inline links from 60em, native `<details>` menu below),
  `/shop/`, `/new-arrivals/`, `/product-category/[...slug]` (nested WooCommerce URLs redirect to the flat canonical), home sections Featured / Shop by Category / New Arrivals.
- **WordPress content (ADR-016):** `lib/wp/` (read-only wp/v2 client, loose zod schemas, sanitizer, keyed stale-while-revalidate source with a remembered failure and a 300-entry cap,
  sample content for the preview), routes `/blog/`, `/blog/[slug]/`, `/blog/category|tag/[slug]/`, `/our-story/`, `/contact/`, `/about/` -> `/our-story/`; Article (BlogPosting) + breadcrumb
  JSON-LD, canonical URLs, sitemap entries, tag pages noindex; `/api/revalidate/` and `/api/catalog-status/` cover it.
- **Reviews (ADR-017):** `lib/reviews/` (Store API source, name shortening, stars, rating JSON-LD) and the submission path (`/api/reviews/`, signed form token, honeypot, same-site check, rate limits,
  `kcpw-core` 0.2.0 `Reviews/` + `WcReviewGateway`); `packages/contracts` `review-logic.ts` with 60+ shared vectors.
- **`wordpress/kcpw-core` (v0.2.0; checkout and personalization from v0.1.0)** the only first-party WordPress code: a pure PHP core (option validator ported from `validateOptions`, line resolver and
  pricing ported from `priceLine`, HMAC request verifier, single-use handoff tokens: 43 chars, SHA-256 hash stored, 10-minute TTL, intents stored not prices) and a thin
  `src/Wp` layer (REST routes `/kcpw/v1/cart/quote`, `/cart/handoff`, `/status`; cart rebuild on redemption through `WC()->cart->add_to_cart()`; a
  "Personalization" product tab; option charges recomputed from the schema at `woocommerce_before_calculate_totals`; readable order-item meta plus a hidden
  `_kcpw_personalization` JSON; cart/checkout revalidation; readiness page). It writes **no product data except `_kcpw_*` meta on the product the owner is editing** and
  contains no payment code (`CoreIsPureTest`). Packaged by `npm run build:core-plugin` (CI artifact `kcpw-core-plugin`).
- **Cart handoff in the storefront:** `POST /api/cart/handoff/` (strict body: line intents only; 403 unless `readCheckoutStatus()` is enabled; local re-validation and re-pricing;
  signed server-to-server call; response redirect accepted only if same origin, path `/`, one `kcpw_handoff` token) and `GET /api/checkout-status/`. The cart page shows a working
  **Checkout** button only when enabled, otherwise the unchanged "checkout coming soon" state. A 409 ("prices changed") reloads the catalog before the shopper retries.
- **Design:** brand palette unchanged; dark text on orange buttons; ink borders/focus rings; cream links in the
  footer. The contrast rules are enforced by a unit test reading the real CSS.
- **CI:** `.github/workflows/ci.yml` runs on every push. Run #1 (commit `d03b756`) **passed in full on GitHub's
  runners**: `npm ci`, guard, format, lint, typecheck, unit tests, and the Playwright + axe e2e suite.
- **`scripts/discovery/analyze-wc-export.mjs`:** read-only analyzer for WooCommerce product CSV exports (own RFC 4180
  parser, entity decoding, duplicate/Any/SKU/stock/plugin-fingerprint checks) with tests; its numbers were
  cross-checked against an independent analysis.
- **Performance:** the product form receives a compact `PurchaseModel` (interchangeable variation rows merged: the real
  bag tag's 169 become 1; 169 distinct are 4.5 KB instead of 31 KB), and browser code imports the zod-free
  `@kcpw/contracts/client` (page scripts 645 KB to 532 KB decoded; the quote schema loads lazily on the cart).
- **Home page:** photo hero with the owner's headline and buttons as real text over a scrim whose worst-case contrast
  is tested; the banner now uses the owner's wide workshop photo (`public/images/kcprintworks-hero.webp` plus a phone crop; see
  `public/images/README.md`); `/about/` now redirects to `/our-story/`, which shows the WordPress page.
- **Real-catalog preview:** `apps/storefront/src/lib/catalog/export/` converts the owner's export into DTOs
  (`CATALOG_SOURCE=export`, refused in production builds). Derived URLs and proposed personalization fields are flagged
  in a banner. Display-only cleanup of marketplace attributes, import footers, plain-text descriptions, long titles.
- **Docker/VPS:** `Dockerfile` (standalone output, non-root), `/api/health/`, `.github/workflows/docker-publish.yml`
  (build, smoke-test, push the tested image to GHCR with `packages: write` on that job only), `deploy/` (compose on the
  external `proxy` network with `expose` only, limits, health check, read-only filesystem; `deploy.sh` with automatic
  and manual rollback), `scripts/docker-smoke.sh`.
- **Discovery tooling (read-only):** `fetch-wc-catalog.mjs`, `compare-variations.mjs`, `duplicate-report.mjs`,
  `propose-categories.mjs`, `inventory-recommendations.mjs`; outputs in `docs/discovery/`.
- **Docs:** architecture, payments, Etsy, plan, migration, discovery, inventory, plugins, decisions, **catalog cleanup
  report** (`docs/CATALOG-CLEANUP.md`), **personalization** (`docs/PERSONALIZATION.md`), **VPS deployment**
  (`docs/DEPLOYMENT-VPS.md`).

## Decisions

Full text in [docs/DECISIONS.md](docs/DECISIONS.md).

| ADR     | Decision                                                                      | Status                 |
| ------- | ----------------------------------------------------------------------------- | ---------------------- |
| 001     | `kcprintworks.com` = Next.js; `shop.kcprintworks.com` = WordPress/WooCommerce | Approved               |
| 002     | Hybrid checkout, official Stripe plugin, single-use cart handoff              | Approved               |
| 003     | Etsy sync as a separate WooCommerce plugin                                    | **Withdrawn (014)**    |
| 004     | Etsy orders imported as WooCommerce orders "Paid on Etsy"                     | Proposed               |
| 005     | WooCommerce is master; per-field ownership; preview before apply              | **Re-adopted by 014**  |
| 006     | Etsy **Seller App** (Seller API Access), read scopes only first               | Revised (was personal) |
| 007     | Personalization solution                                                      | **Pending discovery**  |
| 008     | Catalog delivery: now WooCommerce REST (read-only) + SWR cache + signed refresh | **Revised, built**   |
| 009     | Migration: clone, then cut over; live site stays up                           | Proposed               |
| 010     | Etsy `order.paid` webhook with polling as recovery                            | Proposed               |
| 011     | Accessible foreground pairings on the unchanged palette                       | Approved               |
| 012     | Docker image on GHCR, staging by default (rendering per request since 2026-10-14) | Implemented        |
| 013     | Etsy is the master product catalog (custom `kcpw-etsy` plugin)                | **Superseded by 014**  |
| 014     | **WooCommerce is the single source of truth; sync service is external and interchangeable** | **Owner decision** |

## Blockers and inputs needed from the owner

1. **Answer the questions raised by the product export** (`docs/discovery/INVENTORY.md` §6, Q1 to Q9). Most
   important: **Q1** (open products #124 and #889 in admin, Variations tab: do variations show "Any ..." or
   specific values?) and **Q3** (a redacted recent order with a personalized item: how does a buyer enter the
   name today?). Then the rest of `docs/LIVE-SITE-DISCOVERY.md`: Site Health "Info", WooCommerce system report,
   payments/webhooks, hosting/DNS/SSL/email. This unblocks ADR-007 and the final migration plan.
2. **Review the design preview** (gate G1): run `npm run dev`, or look at the screenshots in a session. Decide
   on logo/wordmark, fonts (currently system fonts), real copy, categories, and missing pages (about, contact,
   shipping/returns, legal).
3. **Choose where staging lives** (host staging feature, separate host, or a new subdomain, which needs DNS
   approval).
4. **WooCommerce Read-only REST key (blocks Step 2 on real data):** create it (Permissions: Read) and put it in the VPS `.env`
   ([docs/DEPLOYMENT-VPS.md](docs/DEPLOYMENT-VPS.md) §9), then run the status and freshness checks ([docs/WOOCOMMERCE-CATALOG.md](docs/WOOCOMMERCE-CATALOG.md) §3).
4a. **Staging WordPress + WooCommerce** (a clone, never the live site) to install `kcpw-core` on, then follow
   [docs/CHECKOUT-STAGING-CHECKLIST.md](docs/CHECKOUT-STAGING-CHECKLIST.md): constants in `wp-config.php`, the official Stripe plugin in **test mode**, per-product
   personalization setup, then `CHECKOUT_ENABLED=true` on the staging container only.
4b. **Tell us how the sync service treats product data** (does a re-sync keep a product's ID and slug, and does it leave `_kcpw_option_schema` alone?). The
   checklist has a short test for each; this decides whether `docs/SYNC-INDEPENDENCE.md` needs more precautions.
5. **Stripe:** account status, who supplies **test** keys, whether Link is wanted, tax and shipping approach.
6. **Optional:** allowlist `kcprintworks.com` (and the WordPress.org / WooCommerce / Stripe download hosts) for the sandbox network so the public site and the real
   WordPress stack can be exercised here, or run the checklist yourself.

## Known issues, limitations, and tech debt

**Unverified or unknown**

- **Plan v2 has not run against the real WordPress/WooCommerce.** Built and tested against stand-ins written from the documented WordPress REST API, WooCommerce Store API and comment behavior. Specifically unverified: the public
  `wp/v2` posts/pages/categories/tags with `_embed` and `_fields` on the owner's site (security plugins can block the REST API); the Store API `products/reviews` answer shape and that it lists only approved reviews; that `wp_new_comment` with
  our filters saves a pending review of type `review` with WooCommerce's `verified` meta on the owner's WooCommerce version; the moderation email; the category ids/slugs (taken from the owner's message, never read from the live site by us). Each has a
  step in `docs/WORDPRESS-CONTENT-AND-REVIEWS.md` §9 or `docs/REVIEWS-STAGING-CHECKLIST.md`.
- **Etsy reviews are not shown** (no legitimate data is known to exist in WooCommerce; nothing is scraped). The discovery queries are in the WordPress guide.
- **Home page review/story sections wait at most 2.5 s** for WordPress/WooCommerce and are left out on a miss; a page of reviews can hold fewer than ten when a row has no star rating (those are never shown).
- **A product's rating on cards is not shown** (only on the product page and in structured data).

- **`kcpw-core` has never run inside WordPress/WooCommerce** (no PHP runtime with WordPress here; WordPress.org and WooCommerce downloads are blocked): the pure core is
  proven against the TypeScript reference with shared vectors (options, line pricing, request signing), and the glue (`src/Wp`: hooks, REST registration, the product tab,
  the handoff table, cart rebuild, order-item meta) is verified only with WordPress/WooCommerce **stubs**. Expect small fixes on the first staging run; the checklist lists the exact tests.
- **Stripe has not been run at all.** We add no payment code; whether the official plugin behaves as designed after our cart rebuild (redirect, webhook, duplicate protection) is unverified.
- **Sync-service behavior is unverified:** we assume a sync service keeps WooCommerce product/variation IDs and slugs stable on re-sync and does not wipe `_kcpw_*` meta. Neither
  service has been observed. If a service re-creates products with new IDs, carts built earlier fail safely (`invalid_lines`), but personalization setups on those products would need re-entering.
- **Etsy is not involved in our code at all**, so no Etsy fact needs verifying here; what Etsy or the sync service puts into WooCommerce (titles, attributes such as Condition or MPN, import footers) is handled
  defensively by the display policy and is only known from the 2026-10-13 export.
- **Step 2 has not run against kcprintworks.com** (unreachable from here, no key yet). The converter follows WooCommerce's documented REST shapes and was
  exercised with synthetic data that mimics the export's oddities. The first real load may expose differences; `/api/catalog-status/` lists every skipped row.
- Known from the 2026-10-13 export: the WooCommerce catalog (71 products, 259 variations). Unknown: the live site's
  plugins, orders, hosting, DNS, SSL, and email, and the Etsy shop contents. **No product data in the repo is
  real**; the raw export is gitignored.
- **Existing catalog problems** (details and owner questions in `docs/discovery/INVENTORY.md`): 256 of 259
  variations have no attribute value ("Any"); 12 groups of duplicate published products; stock counts that look
  like defaults (15 and 20) on made-to-order items; 50 of 66 published products "Uncategorized"; Etsy-style
  attributes visible to shoppers; two weight outliers; Facebook for WooCommerce tied to the old URL. None of these
  has been changed; each live change needs owner approval and staging first.
- Whether the Stripe plugin's flow can be reused as designed (idempotency keys, webhook events, return URL
  handling, restricted keys) is to be confirmed by the Step 3 spikes.

**Storefront**

- All products, copy, and images are **synthetic placeholders** (invented prints, posters, totes). The real catalog
  is 3D-printed card-game, battery, and ammo storage cases plus personalized tags and keychains, so the design
  preview, categories, and copy do not yet look like the real store. The wordmark is text; there is no logo or
  favicon.
- The home banner uses the owner's wide photograph, **1916 px wide**: crisp up to a 1920 px screen, soft on 4K or very high-density displays.
  An original 2800 to 3200 px wide would fix that with no code change (`public/images/README.md`). The type is the system bold sans (no
  font download), not a brand typeface. "Our Story" shows the WordPress page "our-story" (or "coming soon" until it is written).
- In the real-catalog preview the product URLs are derived from titles (the export has no permalinks), image alt text
  and sizes are guesses, and the personalization fields are proposed.
- The container image is a **staging** build: `SITE_ENV`, `NEXT_PUBLIC_SITE_URL`, and `IMAGE_HOSTS` are build-time. Set the repository
  variable `SITE_URL` to the staging address, or canonical URLs say `http://localhost:3000` (harmless while noindex).
- Pages are `force-dynamic`: fine for staging; before going live, add caching headers or incremental caching for speed. Quote prices come
  from the cached catalog (up to `CATALOG_REVALIDATE_SECONDS` old) until checkout is connected.
- Photo dimensions from WooCommerce are unknown (assumed square until loaded). Image optimization of real photos was not exercised end to end here.
- The Dockerfile cannot be built in this sandbox (no Docker daemon); CI verifies it. Only the amd64 architecture is built.
- Open decisions that block personalization work: icons (curated list vs free emoji, because the validator rejects the
  zero-width joiner that many emoji contain), cable colors, the order sample (Q3).
- Checkout is **off by default** in every build and may be enabled in a production build only under the ADR-018 rules (`lib/checkout.ts`, `lib/handoff/shop-guard.ts`); the handoff has only run against a stand-in shop.
  One shop has one `KCPW_STOREFRONT_URL`: it must name the production storefront at go-live, after which a staging container's checkout refuses (live Stripe mode) by design. Coupons are rejected in the
  quote (the shopper can enter one on the WooCommerce checkout).
- `/api/cart/handoff/` has the same body-size check and **no rate limiting** either (neither has an origin check; both are cookie-less and return only to the caller). Each checkout press now makes two signed
  calls to the shop (status, then handoff), and every successful handoff leaves a short-lived row on the shop (purged daily): worth a limit before heavy traffic.
- `/api/cart/quote/` has a body-size check but **no rate limiting** yet. No strict CSP with nonces yet (planned
  for Step 10; baseline security headers are set).
- `sanitize-html` runs on the server at render time (`RichText`), so WooCommerce HTML is sanitized on every path; script/style text is also
  stripped from meta descriptions.
- JSON-LD prices assume two-decimal currencies; the quote route falls back to `USD`. The WooCommerce source hard-codes `USD`;
  read the store currency from `/wp-json/wc/v3/system_status` or settings when multi-currency matters.
- Gallery does not switch images when a variation has its own image. No search, no filters or sorting on the shop
  page, no pagination.
- Accessibility is verified with axe, keyboard, focus, and reflow tests only. **No manual screen-reader pass yet**
  (planned in Step 10).
- Breadcrumb wraps awkwardly on very small widths (cosmetic).

**Tooling**

- Pinned below latest on purpose: TypeScript `~5.9.3` (TS 7 exists), ESLint `^9` (v10 exists). Revisit after
  the ecosystem catches up. `npm audit` has not been run.
- Docker Compose local WordPress environment is not created yet.

## Next steps (suggested order)

00. **Production checkout (owner, ADR-018):** build the production image (done by the workflow, tag `...-production`), then follow [docs/CHECKOUT-PRODUCTION.md](docs/CHECKOUT-PRODUCTION.md): second container in
   `/opt/kcprintworks-production`, `kcpw-core` 0.2.1 and `KCPW_STOREFRONT_URL=https://kcprintworks.com` on the shop, then `CHECKOUT_ENABLED=true` and the §6 test purchase (Stripe test mode first, then one real low-value order).
0. **Plan v2 (owner):** deploy the new staging image, then follow [docs/WORDPRESS-CONTENT-AND-REVIEWS.md](docs/WORDPRESS-CONTENT-AND-REVIEWS.md) §9: write the `our-story` and `contact` pages and a first
   post in WordPress, star the Featured products, check `/api/catalog-status/`. When ready to take reviews: update `kcpw-core` to 0.2.0 on **staging** and follow
   [docs/REVIEWS-STAGING-CHECKLIST.md](docs/REVIEWS-STAGING-CHECKLIST.md) (a test review is trashed, never approved). Send back the Etsy-reviews discovery query results (§5 of the WordPress guide) if you want imported reviews labelled.
1. Owner: answers to INVENTORY.md Q1 to Q9, the rest of the discovery checklist, and G1 design feedback.
2. Update `docs/discovery/INVENTORY.md` with the answers; decide ADR-007; finalize the migration plan inputs
   (`docs/MIGRATION-SHOP-DOMAIN.md` §11).
1a. Owner: install the container (`docs/DEPLOYMENT-VPS.md`), add the staging DNS record and Nginx Proxy Manager host
   (each needs the owner), supply the banner photo without text, answer the P0 items in `docs/CATALOG-CLEANUP.md`.
1b. Run `fetch-wc-catalog.mjs --public` and `compare-variations.mjs` (or send the Variations screenshot) to resolve
   whether the blank attributes are a real "Any"; then re-run `duplicate-report.mjs --rest`.
3. Phase 0 leftovers: local Docker environment for WordPress + WooCommerce + Mailpit with a fixture catalog;
   staging clone (needs owner approval and hosting facts).
4. **Step 2 (storefront side done):** run it against the real store (owner's Read-only key), review `/api/catalog-status/` skips, then URL inventory and
   redirect map, SEO fields mapping, variation parity report, and (later) `kcpw-core` DTO endpoints.
5. **Step 3 (code done, owner steps remain):** stand up a staging WordPress + WooCommerce, install `dist/kcpw-core.zip`, set the constants, add the official Stripe plugin in
   **test mode**, define personalization on a few products, switch `CHECKOUT_ENABLED` on in the **staging** container only, run the matrix in
   [docs/CHECKOUT-STAGING-CHECKLIST.md](docs/CHECKOUT-STAGING-CHECKLIST.md), and send back the results. Fix whatever the real stack shows.
6. Step 4 onward as in the plan: personalized-order and payment testing (idempotency, webhooks, refunds), checkout theme polish, shipping and tax review, then launch readiness (Step 10).
   Later and optional: Etsy order import (no Etsy code of ours; only if the sync service does not already bring orders in) and a fulfillment view.

## How to resume in a new session

1. Read `CLAUDE.md`, this file, and `docs/DECISIONS.md`.
2. `npm ci` (with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the sandbox), then `npm run check` and
   `npm run test:e2e` to confirm the baseline is green.
3. Ask which blockers the owner has cleared before starting Step 2; do not guess at their site.

## Session log

- **2026-10-14, session 1 (tenth part): production checkout (ADR-018, owner request).** `lib/checkout.ts` no longer refuses production builds; it validates them (https shop with no local exception, https storefront address built into the image, `CATALOG_SOURCE=woo`, shop host different from the storefront's, 32+ character secret) and stays **off by default** everywhere.
  A per-press **shop guard** (`lib/handoff/shop-guard.ts`, signed `GET /status`, never cached): a non-production build hands a cart over only to a shop that reports Stripe TEST mode (so staging cannot reach real payments once the shared shop goes live); a production build only to a shop whose reported `storefrontUrl`
  (kcpw-core **0.2.1**, new) has the image's origin. `/api/checkout-status/` now reports `environment`, `allowed`, `blocked` and `returnAddress`. All signing, replay protection, single-use hashed 10-minute links, redirect pinning and strict-body rules are unchanged. Deploy: `docker-compose.production.yml` (extends the staging definition; separate project, service and container names, because a
  shared service name is a shared DNS alias on the `proxy` network), `.env.production.example`, `deploy.sh` `DEPLOY_KIND` (refuses an image of the other kind, and a production directory not using the production compose file), workflow `site_url` input (production default `https://kcprintworks.com`, validated), per-environment concurrency, and production smoke steps.
  Verified here: `npm run check` with the export aside (guard, format, lint, typecheck, 368 + 111 unit tests, 53 script tests, 98 PHP tests, build), 221 e2e, a locally built **production** standalone bundle run with a hostile `SITE_ENV=staging` / `NEXT_PUBLIC_SITE_URL=http://evil.example` (it stayed production and `https://kcprintworks.com`) through all five checkout smoke cases, `docker compose config` for both instances.
  Caught on the way: `.env.production.example` was hidden by both `.gitignore` and `.dockerignore` (`.env.*`); fixed and tested. **Not verified (sandbox cannot reach them):** a real WordPress/WooCommerce running `kcpw-core`, Stripe, the order-received page, and Docker itself (CI builds the image). Nothing on the VPS, WordPress, Stripe or DNS was touched.
- **2026-10-14, session 1 (ninth part): two small changes.** (1) Desktop header: the five links now sit against the Cart button, exactly 32px from Blog to Cart (`.site-nav` is end-aligned in the header grid with a margin that makes
  the 1.5rem grid gap 2rem); the logo and Cart did not move (measured before and after: brand x and cart right edge identical at 960 to 1920px); mobile menu and styling untouched; tested at 960, 1024, 1280, 1440 and 1920. (2) Contact page:
  a Contact Form 7 shortcode, or its rendered form (text included), is removed from WordPress content (`lib/wp/sanitize.ts`, applies to all WordPress pages and posts, with the empty wrappers it leaves); the page's words stay editable in
  WordPress; under them an orange **Email Us** button (`mailto:contact@kcprintworks.com?subject=KCPrintWorks%20Inquiry`) and the address as a link. No form, endpoint, plugin or mail service; Contact stays in the footer only.
- **2026-10-14, session 1 (eighth part): plan v2, approved by the owner with the verified category ids.** Built in five tested stages (details: ADR-016, ADR-017, `docs/WORDPRESS-CONTENT-AND-REVIEWS.md`): (1) the category tree, the new header (Shop | Game Cases |
  Personalized Gifts | New Arrivals | Blog | Cart, responsive, native-`<details>` menu, categories configurable per request), Featured Products (WooCommerce star, never padded), New Arrivals by publication date; (2) the blog, Our Story, Contact from WordPress
  with a hardened sanitizer, SEO, sitemap, JSON-LD, caching and outage behavior; (3) approved reviews, ratings and structured data from WooCommerce; (4) moderated review writing (`/api/reviews/` -> `kcpw-core` 0.2.0, pending only, shared vectors for validation,
  off by default); (5) documentation, deploy settings, smoke-script updates, performance measurement. **No WooCommerce category, product, setting, DNS, Stripe, shipping, free-shipping, hero or checkout behavior was changed.** Bugs the tests caught on the way:
  a "refresh now" did not clear a remembered WordPress outage (fixed, unit-tested); the Next link prefetch warms category pages (so outage tests use an unvisited page); `/about/` now redirects, so the smoke script was updated. Nothing was run against the live
  site. Published and confirmed: `sha-dfc25b6` (CI and image runs green on GitHub; the first push `sha-91de61d` had two CI-only test failures caused by the YouTube frame loading on GitHub's network, fixed by keeping third-party video pages out of the browser tests). A docs-only commit that records this publishes another tag with identical code; deploy `sha-dfc25b6`.
- **2026-10-14, session 1 (seventh part):** two requests. (1) **Free-shipping progress bar in the cart** ([docs/FREE-SHIPPING.md](docs/FREE-SHIPPING.md), ADR-015): a display of one
  configured number (`FREE_SHIPPING_THRESHOLD`, default $40.00, `off` hides it; `FREE_SHIPPING_BEFORE_DISCOUNTS`), read at run time, worked out from the items total only (no shipping input exists, so
  the flat rate cannot leak in), updating at once on quantity changes and removals, honoring an optional quote `discount`, and silent (no promise) whenever eligibility cannot be known accurately. Placed
  above the order summary on desktop and at the top of the cart on phones; paper card, orange fill, near-black text, ink edges (orange on paper alone is 2.83:1). WooCommerce still decides and
  charges the shipping; checkout, Stripe and the handoff were not touched. (2) **Home banner with the owner's photo:** the owner uploaded a 533 px photo and then a wider 1916 x 821 one
  (`Wide Photo.png`); the wide one is used (a phone crop of the same photo for small screens, the original kept in `apps/storefront/assets/hero/`, outside `public/`). Full-width banner, 430 to
  500 px on desktop, left-to-right gradient, two-line bold headline with an orange "Printed", `Shop Now` and a transparent `Our Story`. Found along the way: Next caches resized photos for four
  hours keyed by address, so the e2e server now clears that cache first. Verified locally: `npm run check` (export aside), 128 e2e, the standalone build in every environment, and screenshots at
  320, 390, 768, 1440 and 1920 px. Not verified: the bar against the real WooCommerce Free Shipping settings (staging row N), and the 4K look of a 1916 px photo (a larger original would be sharper).

- **2026-10-14, session 1 (sixth part):** the owner reported that staging (`sha-8529f95`, `CHECKOUT_ENABLED=true`, `KCPW_SHOP_URL` and `WC_BASE_URL` set) still showed the disabled
  Checkout button with "not connected in this design preview". Cause: that text is the *checkout off* branch of `CartView`, and the container found checkout incomplete because the code
  read only `KCPW_API_URL` (and needs `KCPW_HANDOFF_SECRET`); `KCPW_SHOP_URL` was never a name it read, and compose lists variables explicitly, so a name it does not list never reaches the container.
  The working checkout button, loading state, double-press guard, error messages and server-chosen redirect already existed (no hardcoded button). Changes: the shop address now comes from
  `KCPW_API_URL`, then `KCPW_SHOP_URL`, then `WC_BASE_URL` (empty counts as unset; the https rule applies to whichever name was used; an explicit bad value is refused, not replaced); the server log says
  why a switched-on checkout stays off (names only); the disabled copy no longer says "design preview"; the browser also refuses to navigate to a non-web address; a synchronous in-flight lock backs the
  double-press guard; compose passes `KCPW_SHOP_URL`; the publish workflow now starts the image three ways (off, incomplete, fully set) and checks checkout follows the environment alone
  (`scripts/docker-smoke-checkout.sh`); 8 new browser tests (loading, error and retry, dropped connection, hostile client body, foreign and off-path shop links, withdrawn product, intents-only request, non-web address)
  and 5 unit tests. Verified locally: check (export moved aside), 82 e2e, and the real standalone build in all three environments. Nothing on the live site, WooCommerce, Stripe or DNS was touched.

- **2026-10-14, session 1 (fifth part):** owner asked for a storefront independent of the sync service (ExportYourStore now, maybe Nembol later), with WooCommerce as the single
  source of truth, no custom Etsy integration, and priority on WooCommerce integration, personalization, cart handoff, and Stripe checkout. Wrote ADR-014 and `docs/SYNC-INDEPENDENCE.md`;
  **removed `wordpress/kcpw-etsy`** and its docs/scripts (git `29cc10f`); extended the guard so Etsy and sync-service names fail the build in shipped code; added the display policy; built
  `wordpress/kcpw-core` (66 PHP tests, shared vectors with the TypeScript reference) and the signed storefront cart handoff (`/api/cart/handoff/`, off by default and refused in production builds);
  wrote `docs/CHECKOUT-STAGING-CHECKLIST.md`; extended the mock store with a `kcpw-core` stand-in. Nothing on the live site, VPS, Nginx Proxy Manager, DNS, Etsy, the sync service, or Stripe was touched.

- **2026-10-14, session 1 (fourth part, since superseded by the fifth):** owner decided **Etsy is the master catalog**. Wrote ADR-013 and rewrote the Etsy, architecture, and decision docs; built
  `wordpress/kcpw-etsy` v0.1.0 (Seller App connection, read-only client, token vault, listing download, matching report + decisions, dry-run planner, admin screens,
  packaging, CI) with 106 PHP tests; built the storefront's WooCommerce read-only catalog source (cache, signed refresh, status endpoint, image-host allowlist, per-request
  rendering), the freshness script, a mock WooCommerce store, and 14 e2e tests; hardened the Docker/compose/CI path (SITE_ENV cannot be overridden at run time; optimizer
  smoke test). Published `sha-196a701` (CI and image workflows green). Nothing on the live site, VPS, Nginx Proxy Manager, DNS, Etsy, or Stripe was touched.

- **2026-10-13, session 1 (continued, third part):** variation performance (compact purchase model, zod-free browser
  entry, budgets); photo hero; Docker image and GHCR workflow (built, smoke-tested, and published `sha-fe36462`),
  compose, `deploy.sh` with rollback, VPS guide; read-only snapshot and comparison tools; real-catalog preview source;
  shared personalization vectors (and a fix: non-object input is rejected whole); `docs/CATALOG-CLEANUP.md` and
  `docs/PERSONALIZATION.md`. Nothing on the live site, VPS, Nginx Proxy Manager, DNS, Etsy, or Stripe was touched.

- **2026-10-13, session 1 (continued):** received the product export (`cfec3d8c-kcproducts.csv`, 330 rows) and
  analyzed it; found duplicates, "Any" variations, default stock, Etsy-style attributes, and no add-on plugin data;
  wrote `docs/discovery/INVENTORY.md` with nine owner questions; added the analyzer script and tests; added "Any"
  variation support to the contracts and storefront (cart lines now carry chosen attributes) with a fixture shaped
  like the owner's bag tag; updated the decisions, plan (risks R20, R21), Etsy matching notes, and these files.
  Nothing on the live site was touched.
- **2026-10-13, session 1:** wrote architecture, payments, Etsy, plan, decisions docs (approved); added the
  migration plan, live-site discovery procedure, and updated Etsy design (Seller App, `order.paid` webhook with
  polling recovery, Dev MCP verification plan); scaffolded the monorepo, contracts package, guards, and CI;
  built and reviewed the Step 1 storefront slice. Bugs found and fixed through testing: tab characters accepted
  in personalization text; link `rel` stripped by the sanitizer; header overflow at 320 px; cart heading
  spacing and image cell; focus lost after removing the last cart item; invisible characters in a regex. Etsy
  and the live site could not be reached from the sandbox.
