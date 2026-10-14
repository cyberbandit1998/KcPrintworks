# Project Status

Living document. Update it at the end of every session (see [CLAUDE.md](CLAUDE.md)).

- **Last updated:** 2026-10-14 (session 1, after the decision that **Etsy is the master catalog** and the Step 2 WooCommerce request)
- **Branch:** `claude/hopeful-hamilton-lq8pw6` (no pull request opened; owner has not asked for one)
- **Environment:** staging only. The **staging** Docker image (noindex, checkout disabled) runs on the owner's VPS with the placeholder
  catalog; the newest image can read the real WooCommerce catalog once the owner adds a Read-only key (`docs/DEPLOYMENT-VPS.md` §9).
  The WordPress plugin `wordpress/kcpw-etsy` (read-only) is built but **not installed anywhere**. The live WooCommerce site, WordPress,
  MariaDB, Nginx Proxy Manager, Etsy listings, Stripe configuration, and DNS have **not** been touched.

## Where we are

| Phase                                                       | Status                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Architecture and plan                                       | **Approved by the owner 2026-10-13** (see below)                                                          |
| Phase 0: foundations (monorepo, CI, guards)                 | **Done** except staging and local WordPress environments (blocked on discovery/hosting facts)             |
| Live-site discovery (plugins, products, personalization)    | **Partly done.** Product export analyzed (`docs/discovery/INVENTORY.md`); plugins, orders, hosting, DNS still unknown |
| Step 1: Next.js storefront design                           | **Built, awaiting owner design review (gate G1).** Default data is synthetic; `CATALOG_SOURCE=export` previews the owner's real 66 products (titles, prices, options). Photo hero is in; the owner's photo file is still needed |
| Step 2: WooCommerce products and variations                 | **Built, tested against a mock store, not yet run against kcprintworks.com.** Read-only REST source with cache + signed refresh (`docs/WOOCOMMERCE-CATALOG.md`). Needs the owner's Read-only key |
| Etsy as master catalog: architecture and decisions          | **Decided by the owner 2026-10-14** (ADR-013); docs updated (`docs/ETSY-INTEGRATION.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`)|
| Etsy Seller App connection (plugin `kcpw-etsy`)             | **Built, read-only, tested with mocks only.** Needs the owner to register the app and install on staging (`docs/ETSY-SETUP.md`) |
| Read-only import preview (download, matching report, owner decisions, dry-run plan) | **Built, tested with mocks and the real WooCommerce export.** Not run against real Etsy |
| First synchronization into WooCommerce, rollback, scheduling, webhooks | **Not built; needs the owner's approval after reviewing matches and the dry-run** |
| Deployment of the storefront (staging container, VPS)       | **Image published; owner installs it** (`docs/DEPLOYMENT-VPS.md`). Needs the owner's DNS and Nginx Proxy Manager steps |
| Step 3: cart handoff and Stripe checkout (test mode)        | Not started. Checkout button is intentionally disabled                                                    |
| Step 4: personalized order + payment testing                | Not started                                                                                               |
| Etsy order import and fulfillment view (old Steps 8 and 9)  | Not started (design documented; later phase)                                                              |
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

**Etsy is the master product catalog** (ADR-013): products are created and edited on Etsy and synchronize into WooCommerce, which supplies the
Next.js storefront. Etsy owns titles, descriptions, images, variations, colors, and base prices; WooCommerce keeps checkout, shipping, tax, Stripe,
SEO URLs, categories, shipping rules, and approved overrides. Mappings by Etsy listing/inventory IDs; **no duplicates** (a matching report and the
owner's decision on every ambiguous match come first); preview, dry-run, conflict detection, rollback; scheduled sync with webhooks where available;
no Etsy calls from customer requests. **The live WooCommerce site stays unchanged until the owner approves the first synchronization**, and no
WooCommerce product is created, updated, or deleted until the owner has reviewed the proposed matches and changes. Step 2 (real catalog in Next.js)
must read WooCommerce read-only, keep variation IDs/prices/options/personalization, keep checkout disabled, and be verifiable without a Docker rebuild.

### Approvals **not** given (all still required)

Any DNS change (including creating `shop.` or a staging subdomain), SSL issuance on production, Stripe test or
live configuration changes (webhooks, Apple Pay domain, keys), Etsy app registration and OAuth consent (the
owner performs these), any Etsy write scope, **the first synchronization / any WooCommerce product write**, installing `kcpw-etsy` on the live
site, creating a WooCommerce webhook, and the cutover (gate G6). Creating the WooCommerce Read-only REST key is the owner's action.

## What exists in the code

Verified on 2026-10-14: `npm run check` and `npm run test:e2e` pass locally: **103** contracts tests (incl. 33 shared
personalization vectors and a graph test that keeps zod out of the browser entry), **140** storefront unit tests (2 skip in CI because
they read the gitignored export), **46** script tests (analyzer, duplicate/category/stock recommenders, read-only fetcher, variation comparison,
deploy script, freshness script), **106** PHP tests / 5,610 assertions for `kcpw-etsy`, and **65** Playwright e2e tests (axe WCAG 2.2 AA on every
route, no horizontal scroll 320 to 1280 px, keyboard and focus flows, payload and script-size budgets, and 14 against a mock WooCommerce store).
CI-style run with the export moved aside also passes. GitHub Actions results for the pushed commit: see the session log below.

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
- **`wordpress/kcpw-etsy` (v0.1.0, read-only)** ~100 PHP files: Seller App OAuth 2.0 + PKCE, encrypted token vault, rotation-safe
  token source, GET-only rate-limit-aware Etsy client with an allowlisting transport, normalizer, resumable listing collector, matcher
  (strong/weak signals, duplicate "twins" make a match ambiguous), owner decisions + CSV, dry-run planner (field policy, price and
  inventory policies, overrides, three-way conflicts, variation matching, personalization suggestion), admin screens (Connection,
  Import preview, Dry-run plan) behind capability + nonce checks, packaging (`npm run build:etsy-plugin`), CI job + artifact.
  `ReadOnlySafetyTest` fails if any WooCommerce write or Etsy write appears.
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
  is tested; `public/images/hero-banner.jpg` is a neutral placeholder (see `public/images/README.md`); placeholder
  `/about/` page.
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
| 003     | Etsy sync as a separate WooCommerce plugin                                    | Approved; built read-only |
| 004     | Etsy orders imported as WooCommerce orders "Paid on Etsy"                     | Proposed               |
| 005     | WooCommerce is master; per-field ownership; preview before apply              | **Superseded by 013**  |
| 006     | Etsy **Seller App** (Seller API Access), read scopes only first               | Revised (was personal) |
| 007     | Personalization solution                                                      | **Pending discovery**  |
| 008     | Catalog delivery: now WooCommerce REST (read-only) + SWR cache + signed refresh | **Revised, built**   |
| 009     | Migration: clone, then cut over; live site stays up                           | Proposed               |
| 010     | Etsy `order.paid` webhook with polling as recovery                            | Proposed               |
| 011     | Accessible foreground pairings on the unchanged palette                       | Approved               |
| 012     | Docker image on GHCR, staging by default (rendering per request since 2026-10-14) | Implemented        |
| 013     | **Etsy is the master product catalog**                                        | **Owner decision**     |

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
4. **Etsy (blocks the first real connection):** register the Seller App and install `kcpw-etsy` on a **staging** WordPress, following
   [docs/ETSY-SETUP.md](docs/ETSY-SETUP.md) (check whether an existing registered app affects eligibility). Send back the *Test connection*
   rows, then review the matching report and decide each ambiguous match. Confirm listing count and personalization use.
4a. **WooCommerce Read-only REST key (blocks Step 2 on real data):** create it and put it in the VPS `.env` ([docs/DEPLOYMENT-VPS.md](docs/DEPLOYMENT-VPS.md) §9), then run the status and freshness checks ([docs/WOOCOMMERCE-CATALOG.md](docs/WOOCOMMERCE-CATALOG.md) §3).
4b. **Approve (or not) the first synchronization** once you have seen the matches and the dry-run.
5. **Stripe:** account status, who supplies **test** keys, whether Link is wanted, tax and shipping approach.
6. **Optional:** allowlist the Etsy hosts and `kcprintworks.com` for the sandbox network so docs and the public
   site can be read here, or run the verification yourself.

## Known issues, limitations, and tech debt

**Unverified or unknown**

- Etsy facts are **not verified against Etsy's documentation** (hosts blocked) and **the plugin has never talked to Etsy**: every Etsy
  response in the tests is a mock written from memory and excerpts. Seller API Access and webhooks beyond commercial apps are owner-stated.
  See the verification table, `docs/ETSY-INTEGRATION.md` §16. The plugin's *Test connection* is the first real check; first task after it: connect the Etsy
  Dev MCP server, vendor the OpenAPI spec, resolve every "To verify" row.
- **The plugin has never run inside WordPress/WooCommerce** (no PHP runtime with WordPress here): the pure core and the admin logic are tested; the database
  stores (`Wp*Store`), `WpWooReader`, SQL, hooks, and rendering are verified only by WordPress stubs. Expect small fixes on the first staging run.
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
- The home hero needs the owner's photograph (the pasted image was not available as a file); the committed
  `hero-banner.jpg` is a neutral placeholder. The pasted banner has its headline and buttons baked in; the page needs the
  photo **without** the text. "Our Story" links to a placeholder page.
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
- Checkout is disabled (`lib/checkout.ts`); `/api/cart/handoff` does not exist yet. Coupons are rejected in the
  preview quote.
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
4c. **Etsy master pipeline:** owner registers the Seller App and installs the plugin on staging; review *Test connection*; download listings; owner decides
   ambiguous matches; review the dry-run; **then, with approval,** build the first synchronization (apply + change log + rollback) on staging, then scheduling and webhooks, then order import.
5. **Step 3:** cart quote and handoff endpoints in `kcpw-core` (shared test vectors with
   `packages/contracts`), checkout block theme, official Stripe plugin on staging in test mode, spikes listed
   in `docs/IMPLEMENTATION-PLAN.md` §6.
6. Steps 4 to 10 as in the plan. Etsy verification against the official spec happens with the first real connection (see 4c).

## How to resume in a new session

1. Read `CLAUDE.md`, this file, and `docs/DECISIONS.md`.
2. `npm ci` (with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the sandbox), then `npm run check` and
   `npm run test:e2e` to confirm the baseline is green.
3. Ask which blockers the owner has cleared before starting Step 2; do not guess at their site.

## Session log

- **2026-10-14, session 1 (fourth part):** owner decided **Etsy is the master catalog**. Wrote ADR-013 and rewrote the Etsy, architecture, and decision docs; built
  `wordpress/kcpw-etsy` v0.1.0 (Seller App connection, read-only client, token vault, listing download, matching report + decisions, dry-run planner, admin screens,
  packaging, CI) with 106 PHP tests; built the storefront's WooCommerce read-only catalog source (cache, signed refresh, status endpoint, image-host allowlist, per-request
  rendering), the freshness script, a mock WooCommerce store, and 14 e2e tests; hardened the Docker/compose/CI path (SITE_ENV cannot be overridden at run time; optimizer
  smoke test). Nothing on the live site, VPS, Nginx Proxy Manager, DNS, Etsy, or Stripe was touched.

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
