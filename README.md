# KCPrintWorks — Storefront Rebuild

A Next.js storefront for **kcprintworks.com**, with WooCommerce as the single source of truth for products,
prices, variations, and orders, and Stripe (the official WooCommerce plugin) for payments. Products from the Etsy shop at
<https://kcprintworks.etsy.com> reach WooCommerce through the owner's third-party synchronization service
(ExportYourStore today, possibly Nembol later); this project contains no Etsy integration and works with either.

> **Status: architecture approved (2026-10-13); storefront and checkout built, verified with stand-ins only.** No
> credentials are in this repository, and the live WooCommerce site, Etsy listings, payment configuration, and
> DNS have not been touched. Current progress, decisions, and known issues: [PROJECT_STATUS.md](PROJECT_STATUS.md).
> Instructions for AI coding sessions: [CLAUDE.md](CLAUDE.md).

## Documents

| Document | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design: components, domains, caching, data model, security, brand/accessibility tokens |
| [docs/PAYMENTS-STRIPE.md](docs/PAYMENTS-STRIPE.md) | Stripe payment design, cart-to-checkout handoff, personalization, duplicate protection, test plan, contingency design |
| [docs/SYNC-INDEPENDENCE.md](docs/SYNC-INDEPENDENCE.md) | How the storefront stays independent of the Etsy sync service (ExportYourStore now, maybe Nembol later); switching checklist |
| [docs/FREE-SHIPPING.md](docs/FREE-SHIPPING.md) | The cart's free-shipping progress bar: what it shows, its two settings, when it stays silent, and the staging test against WooCommerce's real rules |
| [docs/CHECKOUT-STAGING-CHECKLIST.md](docs/CHECKOUT-STAGING-CHECKLIST.md) | Owner runbook: install `kcpw-core`, Stripe test mode, switch checkout on in staging, test matrix |
| [docs/ETSY-INTEGRATION.md](docs/ETSY-INTEGRATION.md) | Superseded: Etsy is handled by a third-party sync service, not by us |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | The 10-step build order with exit criteria, approval gates, risks, and launch checklist |
| [docs/MIGRATION-SHOP-DOMAIN.md](docs/MIGRATION-SHOP-DOMAIN.md) | Moving WordPress/WooCommerce to `shop.kcprintworks.com`: SSL, redirects, API connections, webhooks, checkout/session behavior, cutover and rollback |
| [docs/LIVE-SITE-DISCOVERY.md](docs/LIVE-SITE-DISCOVERY.md) | Read-only procedure to inventory the live site's plugins, products, and personalization before choosing a solution |
| [docs/discovery/INVENTORY.md](docs/discovery/INVENTORY.md) | What the owner's product export shows about the live catalog (duplicates, "Any" variations, stock defaults, personalization) and the questions it raises |
| [docs/CATALOG-CLEANUP.md](docs/CATALOG-CLEANUP.md) | Prioritized catalog cleanup: fixes, risks, rollbacks, and exactly which changes need the owner's approval |
| [docs/PERSONALIZATION.md](docs/PERSONALIZATION.md) | How personalization is saved per order item, the options compared, and the decisions needed |
| [docs/DEPLOYMENT-VPS.md](docs/DEPLOYMENT-VPS.md) | Docker image on GHCR, install and update commands for the VPS, Nginx Proxy Manager steps, rollback |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log (ADRs), their status, and the inputs still missing |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Living status: done, in progress, next, known issues |
| [CLAUDE.md](CLAUDE.md) | Rules and commands for future Claude Code sessions |

Start with **PROJECT_STATUS.md** for where things stand and **DECISIONS.md** for what is still needed.

## Quick start

```bash
nvm use                 # Node 22
npm ci                  # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 in sandboxes that already have a browser
npm run dev             # storefront on http://localhost:3000 with placeholder fixture products
npm run check           # guard, format, lint, typecheck, unit tests, build
npm run test:e2e        # Playwright + axe accessibility tests
```

The storefront shows placeholder products by default, or your real WooCommerce catalog (read-only) once you add a key. Checkout is
**off by default** and can be switched on in a staging container only. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for what is real and what is pending.

## Guardrails (apply to every phase)

1. **No changes to the live website, live Etsy listings, DNS, or payment configuration
   without explicit approval.** All work happens on local and staging environments with
   Stripe in test mode. Each approval is listed as a gate in the implementation plan.
2. **Card data never touches our servers or database.** Card entry is Stripe-hosted (Stripe.js
   elements). We store only Stripe object IDs.
3. **A redirect is never proof of payment.** Orders become paid only after server-side
   verification with Stripe (verified webhook and/or direct PaymentIntent retrieval).
4. **We build no Etsy integration.** Etsy products arrive in WooCommerce through the owner's sync service. Nothing we ship calls Etsy,
   holds an Etsy credential, or names a sync product (`npm run guard` enforces it), so the storefront keeps working whichever
   service is used ([docs/SYNC-INDEPENDENCE.md](docs/SYNC-INDEPENDENCE.md)).
5. **WooCommerce is the single source of truth** for the website's products, prices, variations, and order data. The storefront reads it
   read-only; the browser never supplies a price.
6. **Checkout is off until the owner turns it on**, in staging only, with Stripe in test mode, after the staging checklist
   ([docs/CHECKOUT-STAGING-CHECKLIST.md](docs/CHECKOUT-STAGING-CHECKLIST.md)).

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
- **Backend:** WordPress + WooCommerce (HPOS), one small first-party plugin (`kcpw-core`: checkout link and
  personalization), plus the official WooCommerce Stripe Payment Gateway plugin. Etsy products reach WooCommerce through the
  owner's third-party sync service; we build no Etsy integration.
- **Testing:** Vitest, Playwright, axe-core, Lighthouse CI, PHPUnit, Stripe CLI.
