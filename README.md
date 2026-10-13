# KCPrintWorks — Storefront Rebuild

A Next.js storefront for **kcprintworks.com**, with WooCommerce as the catalog and
order-management backend, Stripe for payments, and a read-first synchronization with the
Etsy shop at <https://kcprintworks.etsy.com> via the Etsy Open API v3.

> **Status: architecture approved (2026-10-13); storefront build in progress.** Nothing is deployed, no
> credentials are in this repository, and the live WooCommerce site, Etsy listings, payment configuration, and
> DNS have not been touched. Current progress, decisions, and known issues: [PROJECT_STATUS.md](PROJECT_STATUS.md).
> Instructions for AI coding sessions: [CLAUDE.md](CLAUDE.md).

## Documents

| Document | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design: components, domains, caching, data model, security, brand/accessibility tokens |
| [docs/PAYMENTS-STRIPE.md](docs/PAYMENTS-STRIPE.md) | Stripe payment design, cart-to-checkout handoff, personalization, duplicate protection, test plan, contingency design |
| [docs/ETSY-INTEGRATION.md](docs/ETSY-INTEGRATION.md) | Etsy OAuth, product/order/inventory sync, field ownership, import preview, admin UI, future publishing |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | The 10-step build order with exit criteria, approval gates, risks, and launch checklist |
| [docs/MIGRATION-SHOP-DOMAIN.md](docs/MIGRATION-SHOP-DOMAIN.md) | Moving WordPress/WooCommerce to `shop.kcprintworks.com`: SSL, redirects, API connections, webhooks, checkout/session behavior, cutover and rollback |
| [docs/LIVE-SITE-DISCOVERY.md](docs/LIVE-SITE-DISCOVERY.md) | Read-only procedure to inventory the live site's plugins, products, and personalization before choosing a solution |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log (ADRs), their status, and the inputs still missing |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Living status: done, in progress, next, known issues |
| [CLAUDE.md](CLAUDE.md) | Rules and commands for future Claude Code sessions |

Start with **PROJECT_STATUS.md** for where things stand and **DECISIONS.md** for what is still needed.

## Guardrails (apply to every phase)

1. **No changes to the live website, live Etsy listings, DNS, or payment configuration
   without explicit approval.** All work happens on local and staging environments with
   Stripe in test mode. Each approval is listed as a gate in the implementation plan.
2. **Card data never touches our servers or database.** Card entry is Stripe-hosted (Stripe.js
   elements). We store only Stripe object IDs.
3. **A redirect is never proof of payment.** Orders become paid only after server-side
   verification with Stripe (verified webhook and/or direct PaymentIntent retrieval).
4. **The Etsy API never runs on a public page request.** Etsy credentials exist only in the
   WordPress-side sync plugin and are absent from the storefront. Etsy being down cannot
   affect browsing, cart, or payment.
5. **Etsy integration starts read-only.** Write scopes are requested only when a write feature
   is approved. Live Etsy listings are never published or overwritten without approval;
   future publishing creates drafts only.
6. **WooCommerce is the master record for the website storefront.** Etsy data is imported
   under an explicit per-field ownership policy, never an implicit overwrite.
7. **Products are matched by IDs and SKUs, never by title alone.** Low-confidence matches go
   to a manual matching tool.

## Brand

| Token | Value | Use |
|---|---|---|
| `--kc-bg` | `#F3EBDD` | Page background |
| `--kc-ink` | `#111216` | Text, footer background |
| `--kc-accent` | `#FF4A24` | Buttons, accents |
| `--kc-link` | `#2B59E6` | Links, secondary accents |

Contrast-driven usage rules (for example, button label color) are in
[ARCHITECTURE.md §10](docs/ARCHITECTURE.md#10-brand-tokens-and-accessibility).

## Proposed stack

- **Storefront:** Next.js (App Router, TypeScript), Node 22 LTS. Registry `latest` on
  2026-10-13 was Next.js 16.4.0 with React 19.3; the exact versions are pinned at scaffold time.
- **Backend:** WordPress + WooCommerce (HPOS), two small first-party plugins (`kcpw-core`,
  `kcpw-etsy`), plus the official WooCommerce Stripe Payment Gateway plugin.
- **Jobs:** Action Scheduler (bundled with WooCommerce), driven by system cron.
- **Testing:** Vitest, Playwright, axe-core, Lighthouse CI, PHPUnit, Stripe CLI.
