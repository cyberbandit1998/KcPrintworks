# CLAUDE.md

Guidance for Claude Code sessions working in this repository. Read this first, then
[PROJECT_STATUS.md](PROJECT_STATUS.md) (where things stand) and [docs/DECISIONS.md](docs/DECISIONS.md)
(what was decided and what is still open).

## What this project is

A Next.js storefront for **kcprintworks.com** (made-to-order, personalized goods), backed by the existing **WooCommerce** store
(moving to `shop.kcprintworks.com`), paid through the **official WooCommerce Stripe plugin**. **WooCommerce is the single source of truth**
for products, prices, variations, and orders (ADR-014, owner decision 2026-10-14). Etsy products reach WooCommerce through the owner's
third-party sync service (ExportYourStore today, maybe Nembol later): **we build no Etsy integration and depend on neither service**; the storefront
and our plugin must keep working whichever is used ([docs/SYNC-INDEPENDENCE.md](docs/SYNC-INDEPENDENCE.md)). Priority is the buying path:
WooCommerce product integration (built), personalization, cart handoff, Stripe checkout (built, verified with stand-ins only, **off by default**).
The overall architecture was approved on 2026-10-13.

## Hard rules (never break these without explicit owner approval in the conversation)

1. **Do not modify the live WooCommerce site, the Etsy shop or its sync service's settings, payment credentials or configuration, or
   DNS.** Work on local/staging only; Stripe stays in **test mode**. Each such change is an approval gate in
   [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) §2. Creating a staging DNS record or registering a Stripe webhook each counts as a change that needs
   approval. **Installing `kcpw-core` (or adding a constant/key) on the live site is itself a change**: staging first, unless the owner says otherwise.
2. **Checkout is off until the owner turns it on.** `CHECKOUT_ENABLED` defaults to off in every build and needs the shop address and handoff secret
   (`src/lib/checkout.ts`). Since 2026-10-14 (ADR-018, owner request) a **production build may take checkout**, but only with the stricter validation in that file
   (https shop with no local exception, https storefront address baked into the image, `CATALOG_SOURCE=woo`, shop host different from the storefront's) plus the per-press
   shop guard (`lib/handoff/shop-guard.ts`): a non-production build hands a cart over only to a shop that reports Stripe TEST mode; a production build only to a shop that
   returns shoppers to its own address. Do not loosen any of that, switch checkout on in a default deployment file or `.env.example`, or touch Stripe mode/credentials without the
   owner's approval. Never skip a check to make a production run pass.
3. **Never store card data.** Only Stripe object IDs. Never treat a redirect or client callback as proof of
   payment; payment truth is a server-verified Stripe event.
4. **No Etsy integration, no sync-service dependency.** Nothing we ship (storefront, packages, `wordpress/kcpw-core`, deploy files, workflows) calls Etsy,
   holds an Etsy credential, or names a sync product; `npm run guard` enforces it. The storefront relies only on standard WooCommerce data plus our own `_kcpw_*` meta.
5. **The browser never supplies prices.** The cart holds line _intents_ only. Cart/quote schemas are `.strict()`
   so a `price` field is rejected. WooCommerce is the authority for prices, tax, shipping, discounts.
6. **The sync service is the owner's, and it may overwrite what it touches.** Never write to products from the storefront; the only product meta we write is
   `_kcpw_option_schema` (and read `_kcpw_made_to_order`). Match by IDs/SKUs, never by title alone; keep existing WooCommerce variation IDs; do not create or delete
   products. Switching services is a data-quality event, not a code change ([docs/SYNC-INDEPENDENCE.md](docs/SYNC-INDEPENDENCE.md) has the checklist).
7. **Do not invent facts about the owner's catalog, plugins, hosting, or sync service.** Only the product export (2026-10-13) has been seen, summarized in
   `docs/discovery/INVENTORY.md`; plugins, hosting, DNS, orders, and what either sync service does are unknown. Fixture data is synthetic and says so. Do not assume
   customers upload images. The live WooCommerce data, a real WordPress/WooCommerce running `kcpw-core`, and Stripe are **unverified** (the sandbox reaches none of them);
   tests use stand-ins and synthetic fixtures, and docs must say so.
8. **Reviews are real, approved, and moderated.** Never show an unapproved, invented, or store-wide rating; "verified" only from WooCommerce's own mark; a review submission is saved
   PENDING by `kcpw-core` and never published by us; a request must never be able to carry "verified", "approved", or a status (the shared vectors in `packages/contracts/test/vectors/reviews.json`
   keep the storefront and the plugin identical). Writing reviews is OFF unless `REVIEWS_SUBMIT_ENABLED=true`. A test review on the live WooCommerce is trashed, never approved.
9. **We never create, rename, move, or assign WooCommerce categories**, and never write to WordPress. The blog and pages are read from the public REST API; HTML from WordPress is untrusted
   (`lib/wp/sanitize.ts`).
10. **No secrets in the repo.** `.env*` (except `.env.example`) is gitignored; secrets live in host env or
   `wp-config.php`. Never paste tokens into an AI session.

## Repository map

```
apps/storefront/            Next.js 16 App Router storefront (TypeScript)
  src/app/                  routes: /, /shop, /product/[slug], /product-category/[slug], /cart,
                            /api/cart/quote, sitemap, robots, 404
  src/components/           UI components (server by default; client where noted 'use client')
  src/lib/catalog/          CatalogSource interface; fixtures; export (design preview); woo/ = the WooCommerce REST source (GET only, SWR cache)
  src/app/api/              cart/quote, cart/handoff (to kcpw-core), health, catalog-status, checkout-status, revalidate (signed "refresh now")
  src/lib/handoff/          request signing + the server-to-server client for kcpw-core (never in the browser)
  src/lib/wp/               WordPress content (blog, Our Story, Contact): read-only wp/v2 client, zod schemas (loose), hardened HTML sanitizer, keyed SWR cache source,
                            built-in sample content (fixture-client) used when CATALOG_SOURCE is not woo. src/lib/content-cache.ts = the cache + "refresh now" registry
  src/lib/reviews/          approved reviews from WooCommerce's PUBLIC Store API (display) + the submission path (config, signed form token, rate limiter, handler, upstream)
  src/lib/nav.ts, lib/catalog/queries.ts   header slots (runtime-configurable) and the pure category-tree / Featured / New Arrivals / sort / paginate logic
  src/lib/cart/             pure cart logic (cart-state.ts) + localStorage store (store.ts)
  src/styles/               tokens.css (brand + semantic tokens), base.css, components.css
  tests/unit/               Vitest;  tests/e2e/  Playwright + axe
packages/contracts/         shared zod schemas + reference validation/pricing (the oracle for the PHP side).
                            `@kcpw/contracts` = everything (server); `@kcpw/contracts/client` = zod-free (browser)
scripts/guards.mjs          repo guards (no Etsy / sync-service names in shipped code, secret-shaped strings, public env names)
scripts/verify-catalog-freshness.mjs   status / wait / refresh against a running storefront (owner's freshness check; never touches WooCommerce)
scripts/php-check.mjs, build-core-plugin.mjs   PHP lint + plugin tests; builds dist/kcpw-core.zip
scripts/discovery/          analyze-wc-export.mjs: read-only analysis of a WooCommerce product CSV export (+ tests)
docs/                       architecture, payments, sync independence, checkout checklist, plan, migration, discovery, decisions
Dockerfile, deploy/         Docker image (Next.js standalone, multi-stage) and the VPS compose + deploy.sh; see docs/DEPLOYMENT-VPS.md
.github/workflows/          ci.yml (checks) and docker-publish.yml (build, smoke-test, publish to GHCR)
wordpress/kcpw-core/        WordPress plugin (v0.2.1; `/status` also reports `storefrontUrl`): checkout link (quote + single-use handoff), personalization editor/validation/order-item meta, and pending-review intake (`src/Reviews`).
                            Pure PHP core (no WP calls; tested with shared vectors) + thin `src/Wp` layer (tested with stubs); `php tests/run.php`
```

## Commands

Node 22 (`.nvmrc`), npm workspaces. Run from the repo root.

| Command                                 | What it does                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm ci` / `npm install`                | Install (set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the sandbox)                    |
| `npm run dev`                           | Storefront dev server on :3000 (fixtures)                                            |
| `npm run build`                         | Production build                                                                     |
| `npm run guard`                         | Repo guards                                                                          |
| `npm run format:check` / `format`       | Prettier                                                                             |
| `npm run lint`                          | ESLint (flat config; includes jsx-a11y and React Compiler rules)                     |
| `npm run typecheck`                     | `next typegen` + `tsc --noEmit` in each workspace                                    |
| `npm test`                              | Vitest in `packages/contracts` and `apps/storefront`                                 |
| `npm run test:e2e`                      | Playwright + axe (builds, serves on :3100, plus a second storefront on :3101 (checkout switched on) reading a mock WooCommerce store AND a kcpw-core stand-in on :3200 from `tests/support/mock-woo.mjs`; uses `/opt/pw-browsers/chromium` if present; override with `PW_CHROMIUM_PATH`) |
| `npm run test:scripts`                  | `node --test` for `scripts/**` (export analyzer, deploy.sh, freshness script)        |
| `npm run test:php`                      | PHP lint + the kcpw-core tests (`wordpress/kcpw-core/tests/run.php`, no dependencies) |
| `npm run build:core-plugin`             | Packages `dist/kcpw-core.zip` (also a CI artifact)                                   |
| `npm run check`                         | guard, format, lint, typecheck, test, test:scripts, build (e2e is separate)          |
| `node scripts/discovery/analyze-wc-export.mjs <csv>` | Markdown report on a product export (`--json` for machine output). Raw exports live in `docs/discovery/raw/` (gitignored) |

**Definition of done for a change:** guard, format:check, lint, typecheck, unit tests, and e2e all pass; new
behavior has tests; for anything visual, take screenshots with Playwright and actually look at them; docs and
ADRs updated if a decision changed.

## Conventions

- **Colors:** the four brand values in `tokens.css` never change. Components use **semantic tokens only**
  (`--color-*`, `--button-*`, `--footer-*`, `--badge-*`), never `--kc-*`; orange is never text or a control
  border. Buttons are **dark ink text on orange**, not white. `tests/unit/contrast.test.ts` reads the real CSS
  and enforces WCAG AA, so a new color pairing must be added to that test.
- **Accessibility:** target WCAG 2.2 AA. Forms use an error summary that takes focus, errors linked with
  `aria-describedby`, `aria-disabled` (not `disabled`) for sold-out buttons so they stay focusable, and focus
  moves deliberately after destructive actions. Status text is never color-only.
- **Variations:** an empty attribute value means WooCommerce's **"Any"**. Never assume one variation per option
  combination; the cart line carries the shopper's chosen `attributes` and `lineKey` includes them. The real
  catalog is mostly "Any" (see `docs/discovery/INVENTORY.md`).
- **Money** is integer minor units everywhere (`Money`); no floats. Percent effects use `percentOf`.
- **Personalization:** each personalization is its own line (line key includes the options); server-side
  validation is mandatory; the storefront renders from the plugin-agnostic option schema in the DTO.
- **Schemas** that cross a trust boundary use zod `.strict()`.
- **Browser JavaScript budget:** client components, `src/lib/cart/` and `src/lib/variation.ts` import runtime code
  only from `@kcpw/contracts/client` (zod is ~115 KB of JS; ESLint enforces this, and `test/client-entry.test.ts` walks the
  entry's import graph). Logic that the browser needs lives in zod-free `*-logic.ts` modules, schemas in the others. The
  product page sends the form a `PurchaseModel` (compact variation rows, interchangeable ones collapsed), never the product.
  `tests/e2e/bag-tag.spec.ts` holds the payload and script-size budgets.
- **Invisible/special characters:** never put literal zero-width or bidi characters in source. Build them from
  code points (see `FORBIDDEN_RANGES` in `packages/contracts/src/options.ts`).
- **Next.js 16 specifics:** route `params` are Promises (`await params`); `trailingSlash: true` is set to match
  WooCommerce URLs, so call internal API routes with a trailing slash (`/api/cart/quote/`).
- **No Etsy and no sync-service names in shipped code** (`apps/`, `packages/`, `wordpress/`, `deploy/`, `.github/`, `Dockerfile`), not even in comments with hostnames or env names (the guard will fail it). Docs may discuss them.
- Keep comments to what the code cannot say (why, constraints). Match surrounding style (Prettier is enforced).

## Deployment (Docker, InterServer VPS)

- Image: `ghcr.io/cyberbandit1998/kcprintworks-nextjs:sha-<7>`, built and smoke-tested by `docker-publish.yml`, then pushed
  (the tested image is the pushed image). Runs on the VPS via `deploy/docker-compose.yml` on the existing external `proxy`
  network, `expose: 3000` only (never `ports:`), container `kcprintworks-nextjs`. Install, update, rollback: `docs/DEPLOYMENT-VPS.md`.
- `SITE_ENV`, `NEXT_PUBLIC_SITE_URL` and `IMAGE_HOSTS` are **build-time** (next.config.ts `env` writes them into the build; a container's environment cannot change them): default
  `staging` = noindex. A production image is a deliberate manual workflow run (`site_env=production`, `site_url` default `https://kcprintworks.com`) and needs the owner's approval; it is
  deployed from its own directory as a second container (`deploy/docker-compose.production.yml`, `.env.production.example`, `DEPLOY_KIND=production`) beside staging, never over it. See [docs/CHECKOUT-PRODUCTION.md](docs/CHECKOUT-PRODUCTION.md).
- Pages are **rendered per request** (`dynamic = 'force-dynamic'` in the root layout) because the catalog is read from WooCommerce at run time. Runtime-only settings: `CATALOG_SOURCE`
  (`fixtures` default | `woo`), `WC_BASE_URL`, `WC_CONSUMER_KEY`/`WC_CONSUMER_SECRET` (a **Read-only** key the owner creates), `CATALOG_REVALIDATE_SECONDS`, `REVALIDATE_SECRET`,
  and for header/content/reviews `NAV_GAME_CASES`, `NAV_PERSONALIZED_GIFTS`, `HIDDEN_CATEGORY_SLUGS`, `WP_BASE_URL` (defaults to `WC_BASE_URL`), `OUR_STORY_SLUG`, `CONTACT_PAGE_SLUG`, `BLOG_PER_PAGE`,
  `HOME_REVIEWS_MIN_RATING`, `REVIEWS_SUBMIT_ENABLED` (default false), `REVIEWS_RATE_LIMIT`, `REVIEWS_RATE_LIMIT_ALL` (see [docs/WORDPRESS-CONTENT-AND-REVIEWS.md](docs/WORDPRESS-CONTENT-AND-REVIEWS.md)),
  and for checkout `CHECKOUT_ENABLED` (default false; production builds need extra settings, see `lib/checkout.ts`), `KCPW_API_URL` (falls back to `KCPW_SHOP_URL`, then `WC_BASE_URL`), `KCPW_HANDOFF_SECRET`; for the cart's free-shipping bar `FREE_SHIPPING_THRESHOLD` (default `$40.00`, `off` hides it) and `FREE_SHIPPING_BEFORE_DISCOUNTS`. They live only in the VPS `.env`.
  Never put them in the image, the repo, a test, or a chat. See [docs/WOOCOMMERCE-CATALOG.md](docs/WOOCOMMERCE-CATALOG.md).
- Never touch WordPress, MariaDB, Nginx Proxy Manager, DNS, or Stripe from these files. `deploy.sh` only runs `docker compose` for this
  project; its test fails if it ever issues another kind of docker command.
- The WooCommerce source is GET-only (the client has no write method), refuses redirects and plain http, never sends credentials in a URL, and its cache keeps serving the last good copy when WooCommerce fails.
- No Docker daemon in this sandbox: the Dockerfile itself is verified by the GitHub Actions run, not locally. Everything around it
  (standalone build, `scripts/docker-smoke.sh`, read-only + unprivileged run, `docker compose config`) can be checked here.

## Environment limits (important)

This cloud sandbox's network policy blocks several hosts. Observed on 2026-10-13/14: **`kcprintworks.com`**, **wordpress.org / downloads.wordpress.org** (so no real WordPress or
WooCommerce can be installed here), **GitHub downloads of other repositories**, and **Stripe** fail DNS or return 403 from the proxy. GitHub (this repo), the npm registry, Packagist metadata,
and the Ubuntu archive work. Consequences:

- `kcpw-core` runs here only against stand-ins (`tests/wp-stubs.php`) and the storefront only against a mock store. The shared vectors prove the *logic*; the WordPress/WooCommerce
  glue and Stripe are proven only by the owner running [docs/CHECKOUT-STAGING-CHECKLIST.md](docs/CHECKOUT-STAGING-CHECKLIST.md). If the owner allowlists the hosts, re-check and run a real WordPress here.
- Do not "work around" a blocked host with mocked or made-up results; say what is unverified.

## Pitfalls already hit (save yourself the time)

- **Stale servers give misleading screenshots.** A leftover `next start` on the same port makes a new start fail
  with EADDRINUSE while the old process serves HTML pointing at CSS files that no longer exist (unstyled
  pages, 500 for CSS). Find the PID with `ps aux | grep next-server` and `kill <pid>` before re-shooting.
- **Do not use `pkill -f <pattern>` in a command that contains the pattern**: it kills the shell running it.
- Playwright treats `aria-disabled="true"` as not clickable; use `click({ force: true })` in tests that
  intentionally click such buttons.
- Setting state synchronously in an effect fails the React Compiler lint rule; set state in async callbacks and
  derive the rest during render (see `CartView.tsx`).
- After removing the last cart item, focus must be moved **after** the re-render (a ref flag plus an effect),
  not on the heading that is about to unmount.
- WooCommerce product exports are written in batches of 50 and gain columns as they go, so early rows are
  **shorter** than the header (pad with blanks). In variation rows the `Parent` column holds the parent's **SKU or
  `id:<n>`**, not necessarily its ID.
- Node 22 `node --test scripts/` fails on a directory; use a glob (`"scripts/**/*.test.mjs"`).
- Axe passing does not prove the CSS loaded. Look at a screenshot.
- **Tests must pass without the gitignored export.** `docs/discovery/raw/` exists in the sandbox but not in CI. A suite that
  reads it must skip with `describe.skipIf` **and** load lazily inside `it` (vitest runs a skipped suite's body while
  collecting). Before pushing, simulate CI: move `docs/discovery/raw/products.csv` aside, run `npm run check`, move it back.
- Use absolute paths in shell commands; the working directory can shift between calls.
- Playwright `expect(bigString).not.toContain(x)` prints the whole string on failure (megabytes of page source): assert `.includes(x)` is `false` with a message instead.
- Tests that read `docs/discovery/raw/products.csv` (gitignored) must skip **and** load lazily; simulate CI by moving it aside (`mv docs/discovery/raw/products.csv /tmp/...`) before pushing.
- Playwright runs files in parallel: specs that share the mock store (`woo-catalog.spec.ts`) must stay in ONE file with `mode: 'serial'`. That includes the blog / reviews / review-form tests that
  use the mock WordPress, Store API and kcpw-core stand-in (`tests/support/wp-fixture.mjs`, `mock-woo.mjs`). Specs on the default server (fixtures, port 3100) are `blog.spec.ts` and `reviews.spec.ts`.
- The review form needs 3 seconds after the page is drawn (a bot filter): e2e waits before sending. On the woo server a page-wide `getByRole('radio')` / `getByLabel('Name')` also matches the review form: scope to `.pdp`.
- WordPress REST: `_fields` hides everything not listed, and `_embed` only appears if `_embedded`/`_links` are in `_fields` (the mock imitates this). `has_password=false` keeps protected posts out of counts.
- A mid-load `invalidate()` must not be lost: `SwrCache` uses a generation counter; do not "simplify" it back to a boolean.
- WordPress/PHP: the plugin core must not call WordPress functions (a test enforces it); anything needing WP goes in `src/Wp` behind an interface, with a fake in `tests/`.

## Git workflow

- Develop on the designated branch (currently `claude/hopeful-hamilton-lq8pw6`); push with
  `git push -u origin <branch>`. **Do not open a pull request unless the owner asks.**
- Commit messages: imperative summary, a short body explaining why, then the attribution trailers used so far
  (`Co-Authored-By: Claude <noreply@anthropic.com>` and the `Claude-Session:` URL for the session).
- Prettier formatting is enforced, and CI (`.github/workflows/ci.yml`) runs the full check including e2e.

## Keeping the handoff current

At the end of a session, update [PROJECT_STATUS.md](PROJECT_STATUS.md): what changed, test status, known
issues, and the next steps. If a decision changed, update the ADR in docs/DECISIONS.md rather than only
mentioning it in chat.
