# CLAUDE.md

Guidance for Claude Code sessions working in this repository. Read this first, then
[PROJECT_STATUS.md](PROJECT_STATUS.md) (where things stand) and [docs/DECISIONS.md](docs/DECISIONS.md)
(what was decided and what is still open).

## What this project is

A Next.js storefront for **kcprintworks.com** (made-to-order, personalized goods), backed by the
existing **WooCommerce** store (moving to `shop.kcprintworks.com`), paid through the **official WooCommerce
Stripe plugin**. **Etsy is the master product catalog (owner decision 2026-10-14, ADR-013):** products are created and
edited on <https://kcprintworks.etsy.com> and flow `Etsy -> kcpw-etsy plugin -> WooCommerce -> Next.js`, using the Etsy
Open API v3 with a Seller App. WooCommerce keeps checkout, shipping, tax, and Stripe. The overall architecture was approved on 2026-10-13.

## Hard rules (never break these without explicit owner approval in the conversation)

1. **Do not modify the live WooCommerce site, live Etsy listings, payment credentials or configuration, or
   DNS.** Work on local/staging only; Stripe stays in **test mode**. Each such change is an approval gate in
   [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) §2. Creating a staging DNS record, registering a
   Stripe webhook, or enabling an Etsy write scope each counts as a change that needs approval.
2. **Etsy integration is read-only toward Etsy, always, and previews before applying.** No Etsy write scopes
   (`shops_r`, `listings_r`, later `transactions_r`). The `kcpw-etsy` plugin has **no WooCommerce write code yet**
   (`ReadOnlySafetyTest` fails if any appears). The first synchronization is a separate step that needs the owner's
   approval after reviewing the matching report and the dry-run; new listings become **drafts only**. Installing the plugin
   (or any constant/key) on the **live** site is itself a change: do it on staging unless the owner says otherwise.
3. **Never store card data.** Only Stripe object IDs. Never treat a redirect or client callback as proof of
   payment; payment truth is a server-verified Stripe event.
4. **The storefront never has Etsy credentials or calls Etsy.** All Etsy code lives in the WordPress plugin
   (`wordpress/kcpw-etsy`). `npm run guard` enforces this.
5. **The browser never supplies prices.** The cart holds line _intents_ only. Cart/quote schemas are `.strict()`
   so a `price` field is rejected. WooCommerce is the authority for prices, tax, shipping, discounts.
6. **Etsy is master for product content; WooCommerce is master for the website's operation.** Etsy owns title, description,
   images, variations, colors, and base prices; WooCommerce owns slug/SEO, categories, shipping and tax rules, the
   personalization schema, the inventory policy, and approved overrides (per-field policy in
   [docs/ETSY-INTEGRATION.md](docs/ETSY-INTEGRATION.md) §7). Match by IDs/SKUs, never by title alone; never create a product
   that might duplicate an existing one without the owner's decision; keep existing WooCommerce variation IDs.
7. **Do not invent facts about the owner's catalog, plugins, hosting, or Etsy shop.** Only the product export
   (2026-10-13) has been seen, summarized in `docs/discovery/INVENTORY.md`; plugins, hosting, DNS, orders, and the
   Etsy shop are unknown (see "Environment limits"). Fixture data is synthetic placeholder and says so; it does not
   describe real products. Personalization plugin choice
   (ADR-007) is **undecided** until the discovery in [docs/LIVE-SITE-DISCOVERY.md](docs/LIVE-SITE-DISCOVERY.md)
   is done. Do not assume customers upload images. Etsy's real API shapes, the live WooCommerce data, and the plugin running on a
   real WordPress are **unverified** (the sandbox reaches none of them); tests use mocks and synthetic fixtures, and docs must say so.
8. **No secrets in the repo.** `.env*` (except `.env.example`) is gitignored; secrets live in host env or
   `wp-config.php`. Never paste tokens into an AI session.

## Repository map

```
apps/storefront/            Next.js 16 App Router storefront (TypeScript)
  src/app/                  routes: /, /shop, /product/[slug], /product-category/[slug], /cart,
                            /api/cart/quote, sitemap, robots, 404
  src/components/           UI components (server by default; client where noted 'use client')
  src/lib/catalog/          CatalogSource interface; fixtures; export (design preview); woo/ = the WooCommerce REST source (GET only, SWR cache)
  src/app/api/              cart/quote, health, catalog-status (what is loaded), revalidate (signed "refresh now")
  src/lib/cart/             pure cart logic (cart-state.ts) + localStorage store (store.ts)
  src/styles/               tokens.css (brand + semantic tokens), base.css, components.css
  tests/unit/               Vitest;  tests/e2e/  Playwright + axe
packages/contracts/         shared zod schemas + reference validation/pricing (the oracle for the PHP side).
                            `@kcpw/contracts` = everything (server); `@kcpw/contracts/client` = zod-free (browser)
scripts/guards.mjs          repo guards (Etsy isolation, secret-shaped strings, public env names)
scripts/verify-catalog-freshness.mjs   status / wait / refresh against a running storefront (owner's freshness check; never touches WooCommerce)
scripts/php-check.mjs, build-etsy-plugin.mjs   PHP lint + plugin tests; builds dist/kcpw-etsy.zip
scripts/discovery/          analyze-wc-export.mjs: read-only analysis of a WooCommerce product CSV export (+ tests)
docs/                       architecture, payments, Etsy, plan, migration, discovery, decisions
Dockerfile, deploy/         Docker image (Next.js standalone, multi-stage) and the VPS compose + deploy.sh; see docs/DEPLOYMENT-VPS.md
.github/workflows/          ci.yml (checks) and docker-publish.yml (build, smoke-test, publish to GHCR)
wordpress/kcpw-etsy/        WordPress plugin, read-only (v0.1.0): Seller App OAuth, Etsy client, listing download, matcher + owner decisions,
                            dry-run planner, admin screens. Pure PHP core (no WP calls) + thin `src/Wp` layer; `php tests/run.php`
wordpress/                  (planned) kcpw-core and the checkout theme: NOT created yet
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
| `npm run test:e2e`                      | Playwright + axe (builds, serves on :3100, plus a second storefront on :3101 reading a mock WooCommerce on :3200 from `tests/support/mock-woo.mjs`; uses `/opt/pw-browsers/chromium` if present; override with `PW_CHROMIUM_PATH`) |
| `npm run test:scripts`                  | `node --test` for `scripts/**` (export analyzer, deploy.sh, freshness script)        |
| `npm run test:php`                      | PHP lint + the kcpw-etsy tests (`wordpress/kcpw-etsy/tests/run.php`, no dependencies) |
| `npm run build:etsy-plugin`             | Packages `dist/kcpw-etsy.zip` (also a CI artifact)                                   |
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
- **No Etsy in the storefront**, not even in comments with hostnames or env names (the guard will fail it).
- Keep comments to what the code cannot say (why, constraints). Match surrounding style (Prettier is enforced).

## Deployment (Docker, InterServer VPS)

- Image: `ghcr.io/cyberbandit1998/kcprintworks-nextjs:sha-<7>`, built and smoke-tested by `docker-publish.yml`, then pushed
  (the tested image is the pushed image). Runs on the VPS via `deploy/docker-compose.yml` on the existing external `proxy`
  network, `expose: 3000` only (never `ports:`), container `kcprintworks-nextjs`. Install, update, rollback: `docs/DEPLOYMENT-VPS.md`.
- `SITE_ENV`, `NEXT_PUBLIC_SITE_URL` and `IMAGE_HOSTS` are **build-time** (next.config.ts `env` writes them into the build; a container's environment cannot change them): default
  `staging` = noindex. A production image is a deliberate manual workflow run and needs the owner's approval. Checkout is the constant `checkoutAvailable = false`, not a setting.
- Pages are **rendered per request** (`dynamic = 'force-dynamic'` in the root layout) because the catalog is read from WooCommerce at run time. Runtime-only settings: `CATALOG_SOURCE`
  (`fixtures` default | `woo`), `WC_BASE_URL`, `WC_CONSUMER_KEY`/`WC_CONSUMER_SECRET` (a **Read-only** key the owner creates), `CATALOG_REVALIDATE_SECONDS`, `REVALIDATE_SECRET`. They live only in the VPS `.env`.
  Never put them in the image, the repo, a test, or a chat. See [docs/WOOCOMMERCE-CATALOG.md](docs/WOOCOMMERCE-CATALOG.md).
- Never touch WordPress, MariaDB, Nginx Proxy Manager, DNS, or Stripe from these files. `deploy.sh` only runs `docker compose` for this
  project; its test fails if it ever issues another kind of docker command.
- The WooCommerce source is GET-only (the client has no write method), refuses redirects and plain http, never sends credentials in a URL, and its cache keeps serving the last good copy when WooCommerce fails.
- No Docker daemon in this sandbox: the Dockerfile itself is verified by the GitHub Actions run, not locally. Everything around it
  (standalone build, `scripts/docker-smoke.sh`, read-only + unprivileged run, `docker compose config`) can be checked here.

## Environment limits (important)

This cloud sandbox's network policy blocks several hosts. Observed on 2026-10-13: **all Etsy hosts**
(`developers.etsy.com`, `developer.etsy.com`, `help.etsy.com`, `www.etsy.com`, `api.etsy.com`,
`mcp.api.etsycloud.com`) and **`kcprintworks.com`** fail DNS or return 403 from the proxy. GitHub and the npm
registry work. Consequences:

- Etsy API facts in the docs are tagged Confirmed / Owner-stated / Reported / To verify
  ([docs/ETSY-INTEGRATION.md](docs/ETSY-INTEGRATION.md) §16). Do not promote a fact without reading Etsy's
  official docs or the OpenAPI spec (the Etsy Dev MCP server, once reachable; see ETSY §2.1).
- The live site's plugins/products could not be inspected; the owner runs the read-only procedure in
  LIVE-SITE-DISCOVERY.md. If the owner allowlists the hosts (cloud environment settings), re-check.
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
