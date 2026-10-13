# Project Status

Living document. Update it at the end of every session (see [CLAUDE.md](CLAUDE.md)).

- **Last updated:** 2026-10-13 (session 1, after the product export, plugin list, banner photo, and Docker/VPS request)
- **Branch:** `claude/hopeful-hamilton-lq8pw6` (no pull request opened; owner has not asked for one)
- **Environment:** design preview only. A **staging** Docker image (noindex, placeholder catalog, checkout disabled) is
  published to GHCR and ready to run on the owner's VPS (`docs/DEPLOYMENT-VPS.md`); first verified tag `sha-fe36462`.
  The owner has not yet run it. The live WooCommerce site, WordPress, MariaDB, Nginx Proxy Manager, Etsy listings,
  Stripe configuration, and DNS have **not** been touched.

## Where we are

| Phase                                                       | Status                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Architecture and plan                                       | **Approved by the owner 2026-10-13** (see below)                                                          |
| Phase 0: foundations (monorepo, CI, guards)                 | **Done** except staging and local WordPress environments (blocked on discovery/hosting facts)             |
| Live-site discovery (plugins, products, personalization)    | **Partly done.** Product export analyzed (`docs/discovery/INVENTORY.md`); plugins, orders, hosting, DNS still unknown |
| Step 1: Next.js storefront design                           | **Built, awaiting owner design review (gate G1).** Default data is synthetic; `CATALOG_SOURCE=export` previews the owner's real 66 products (titles, prices, options). Photo hero is in; the owner's photo file is still needed |
| Step 2: WooCommerce products and variations                 | Not started (needs staging + discovery inputs). Read-only snapshot and comparison tools exist and are untested against the live site |
| Deployment of the storefront (staging container, VPS)       | **Image published; owner installs it** (`docs/DEPLOYMENT-VPS.md`). Needs the owner's DNS and Nginx Proxy Manager steps |
| Step 3: cart handoff and Stripe checkout (test mode)        | Not started. Checkout button is intentionally disabled                                                    |
| Step 4: personalized order + payment testing                | Not started                                                                                               |
| Steps 5 to 9: Etsy app, preview/mapping, sync, orders, admin | Not started (design documented; Etsy docs could not be read, see Known issues)                            |
| Step 10: full integration test and launch readiness         | Not started                                                                                               |

### Approvals received (owner message, 2026-10-13)

Approved: Next.js storefront at `kcprintworks.com`; WooCommerce backend with `shop.kcprintworks.com` as the
proposed checkout/admin domain; the official WooCommerce Stripe plugin; secure single-use cart handoff; a
separate WooCommerce plugin for Etsy sync; accessible foreground colors on the unchanged brand palette.
Instructions: keep the live site operational and document the migration before moving anything; preserve all
existing WooCommerce variations with per-item personalization stored in orders; inspect installed plugins
before choosing a personalization solution; do not assume image uploads; keep Etsy read-only initially with a
preview before applying; use staging and Stripe test mode; build in phases.

### Approvals **not** given (all still required)

Any DNS change (including creating `shop.` or a staging subdomain), SSL issuance on production, Stripe test or
live configuration changes (webhooks, Apple Pay domain, keys), Etsy app registration and OAuth consent (the
owner performs these), any Etsy write scope, any change to the live WooCommerce site, and the cutover (gate G6).

## What exists in the code

Verified on 2026-10-13: `npm run check` and `npm run test:e2e` pass: **103** contracts tests (incl. 33 shared
personalization vectors and a graph test that keeps zod out of the browser entry), **99** storefront unit tests,
**37** script tests (analyzer, duplicate/category/stock recommenders, read-only fetcher, variation comparison, deploy
script), **51** Playwright e2e tests (axe WCAG 2.2 AA on every route, no horizontal scroll 320 to 1280 px,
keyboard and focus flows, payload and script-size budgets). GitHub Actions: CI and **Publish Docker image** both
green on `fe36462`.

- **`packages/contracts`:** integer money; plugin-agnostic personalization option schema and `validateOptions`;
  strict product DTO (rejects Etsy fields); strict cart line intents (rejects client prices); `priceLine`
  reference pricing (the oracle that the PHP side must match with shared vectors in Step 3). **Supports
  WooCommerce "Any" variations** (empty attribute value): cart lines carry the shopper's chosen `attributes`,
  `findVariation` prefers the most specific variation, and a fixed variation fills in its own values.
- **`apps/storefront`:** home, shop, category, product page (variation chips, personalization form, validation
  error summary, live item price), cart (server-quoted via `/api/cart/quote/`), 404, sitemap, robots (noindex
  unless `SITE_ENV=production`), JSON-LD, sanitized rich text, security headers. Data comes from a **placeholder
  fixture catalog** behind `CatalogSource`; `CATALOG_SOURCE=woo` throws until Step 2.
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
| 003     | Etsy sync as a separate WooCommerce plugin on Action Scheduler                | Approved               |
| 004     | Etsy orders imported as WooCommerce orders "Paid on Etsy"                     | Proposed               |
| 005     | WooCommerce is master; per-field ownership; preview before apply              | Proposed               |
| 006     | Etsy **Seller App** (Seller API Access), read scopes only first               | Revised (was personal) |
| 007     | Personalization solution                                                      | **Pending discovery**  |
| 008     | Cached DTO endpoints + tag revalidation for catalog delivery                  | Proposed               |
| 009     | Migration: clone, then cut over; live site stays up                           | Proposed               |
| 010     | Etsy `order.paid` webhook with polling as recovery                            | Proposed               |
| 011     | Accessible foreground pairings on the unchanged palette                       | Approved               |

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
4. **Etsy:** register the Seller App (check whether an existing registered app affects eligibility), supply
   redirect URIs when asked. Confirm listing count and personalization use.
5. **Stripe:** account status, who supplies **test** keys, whether Link is wanted, tax and shipping approach.
6. **Optional:** allowlist the Etsy hosts and `kcprintworks.com` for the sandbox network so docs and the public
   site can be read here, or run the verification yourself.

## Known issues, limitations, and tech debt

**Unverified or unknown**

- Etsy facts are **not verified against Etsy's documentation** (hosts blocked). Seller API Access and webhooks
  beyond commercial apps are owner-stated; the Seller App help-center article was only seen through search
  excerpts. See the verification table, `docs/ETSY-INTEGRATION.md` §16. First task of Step 5: connect the Etsy
  Dev MCP server, vendor the OpenAPI spec, resolve every "To verify" row.
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
- The container image is a **staging** build: `SITE_ENV` and `NEXT_PUBLIC_SITE_URL` are build-time. Set the repository
  variable `SITE_URL` to the staging address, or canonical URLs say `http://localhost:3000` (harmless while noindex).
- The Dockerfile cannot be built in this sandbox (no Docker daemon); CI verifies it. Only the amd64 architecture is built.
- Open decisions that block personalization work: icons (curated list vs free emoji, because the validator rejects the
  zero-width joiner that many emoji contain), cable colors, the order sample (Q3).
- Checkout is disabled (`lib/checkout.ts`); `/api/cart/handoff` does not exist yet. Coupons are rejected in the
  preview quote.
- `/api/cart/quote/` has a body-size check but **no rate limiting** yet. No strict CSP with nonces yet (planned
  for Step 10; baseline security headers are set).
- `sanitize-html` runs on the server only; it must also cover content coming from WooCommerce in Step 2 (it is
  already applied to `descriptionHtml`).
- JSON-LD prices assume two-decimal currencies; the quote route falls back to `USD`. Make currency come from
  WooCommerce data in Step 2.
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
4. **Step 2:** `kcpw-core` read API and DTO contract tests; `WooCatalogSource` in the storefront (tag-based
   revalidation, HMAC revalidation endpoint, preview mode); variation parity report; URL inventory and redirect
   map; SEO fields mapping.
5. **Step 3:** cart quote and handoff endpoints in `kcpw-core` (shared test vectors with
   `packages/contracts`), checkout block theme, official Stripe plugin on staging in test mode, spikes listed
   in `docs/IMPLEMENTATION-PLAN.md` §6.
6. Steps 4 to 10 as in the plan. Etsy work begins with verification against the official spec (Step 5).

## How to resume in a new session

1. Read `CLAUDE.md`, this file, and `docs/DECISIONS.md`.
2. `npm ci` (with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the sandbox), then `npm run check` and
   `npm run test:e2e` to confirm the baseline is green.
3. Ask which blockers the owner has cleared before starting Step 2; do not guess at their site.

## Session log

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
