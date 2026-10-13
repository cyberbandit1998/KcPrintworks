# Project Status

Living document. Update it at the end of every session (see [CLAUDE.md](CLAUDE.md)).

- **Last updated:** 2026-10-13 (session 1, after the owner supplied the product export)
- **Branch:** `claude/hopeful-hamilton-lq8pw6` (no pull request opened; owner has not asked for one)
- **Environment:** local/design preview only. Nothing is deployed. The live WooCommerce site, Etsy listings,
  Stripe configuration, and DNS have **not** been touched.

## Where we are

| Phase                                                       | Status                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Architecture and plan                                       | **Approved by the owner 2026-10-13** (see below)                                                          |
| Phase 0: foundations (monorepo, CI, guards)                 | **Done** except staging and local WordPress environments (blocked on discovery/hosting facts)             |
| Live-site discovery (plugins, products, personalization)    | **Partly done.** Product export analyzed (`docs/discovery/INVENTORY.md`); plugins, orders, hosting, DNS still unknown |
| Step 1: Next.js storefront design                           | **First slice built, awaiting owner design review (gate G1).** Uses synthetic placeholder products; real catalog is card-game cases (not yet reflected in the preview) |
| Step 2: WooCommerce products and variations                 | Not started (needs staging + discovery inputs)                                                            |
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

Verified on 2026-10-13: `npm run guard`, `format:check`, `lint`, `typecheck` clean; **48** contracts tests,
**65** storefront unit tests, and **4** script tests pass; **41** Playwright e2e tests pass (including axe WCAG 2.2 AA
on every route, no horizontal scroll at 320/375/768/1280 px, keyboard and focus flows). CI run #1 (commit
`d03b756`) passed on GitHub's runners; later commits are checked by the same workflow.

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
- **Docs:** architecture, payments, Etsy, plan, migration, discovery, inventory, decisions (all in `docs/`).

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
- Real product titles run up to 127 characters (median 68) and descriptions are plain text with line breaks or
  HTML; cards currently do not clamp long titles.
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
2a. Optional, once Q1 is answered: rebase the design preview on the real catalog (real titles, categories, price and
   variation shapes; card titles clamped) so the G1 review reflects the actual store.
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
