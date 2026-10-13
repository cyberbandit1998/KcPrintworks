# Decisions and Open Inputs

## 1. What I need from you

I found an **empty repository** (no branches, no commits), so there was no earlier Next.js rebuild or
plan to update. I wrote the architecture from your brief. The items below are things I could not
inspect from here; each has a default I will use if you do not say otherwise.

### 1.1 Decisions to sign off

| # | Decision | My recommendation (default) | Why it matters |
|---|---|---|---|
| ADR-001 | Domain topology | `www.kcprintworks.com` = Next.js; `shop.kcprintworks.com` = WordPress, admin, checkout, Stripe webhooks | Apple Pay and webhooks bind to the shop host; any DNS change needs your approval (G6) |
| ADR-002 | Checkout approach | Hybrid: Next.js storefront and cart; WooCommerce-hosted checkout with the official Stripe plugin | Everything in PAYMENTS-STRIPE.md depends on it; the alternative costs far more code |
| ADR-003 | Where the Etsy sync lives | WordPress plugin `kcpw-etsy` on Action Scheduler | Direct WooCommerce access, bundled job queue, admin UI in WP admin |
| ADR-004 | Etsy orders | Import as WooCommerce orders marked "Paid on Etsy" | One fulfillment queue; trade-offs listed below |
| ADR-005 | Source of truth | WooCommerce owns the website; field-level policy; import-once defaults; Woo-owned SEO | Prevents overwrites of SEO copy, prices, variations |
| ADR-006 | Etsy access class | Personal access, read-only scopes first, no commercial application | Lowest approval risk for a single owned shop |
| ADR-007 | Personalization options | Thin first-party option schema in `kcpw-core` (unless you already use an add-ons plugin) | Headless needs the schema in JSON and server-side pricing |
| ADR-008 | Catalog delivery | Public cached DTO endpoints in `kcpw-core` with tag-based revalidation | Fewer round trips than raw WooCommerce REST; no Etsy fields in public data |

### 1.2 Inputs I need

1. **Hosting:** where does WooCommerce run today, and can a staging clone be made? PHP version,
   WooCommerce version, HPOS status, ability to run system cron/WP-CLI?
2. **Current plugins:** SEO plugin (Yoast, Rank Math, other), product add-ons or personalization
   plugin, shipping and tax plugins, any existing Stripe/PayPal plugin.
3. **Catalog shape:** approximate number of products, how many have variations, how many are
   stock-limited, and how personalization works today (free text only, or choices, or image upload?).
4. **Etsy shop shape:** approximate number of listings, how many have variations, how many use Etsy's
   personalization field, and whether Etsy SKUs are consistently set. (I could not open the shop
   from this environment.)
5. **Stripe:** account activated and verified? Preferred statement descriptor? Link on or off?
   Who will supply test keys and, later, live keys?
6. **Tax and shipping:** countries you ship to, tax approach (WooCommerce tax tables, Stripe Tax, or a
   service), flat versus live-rate shipping.
7. **Next.js hosting:** Vercel (my default) or self-hosted?
8. **Email:** current sending provider and domain.
9. **Etsy price rule:** keep website and Etsy prices fully independent (default), or define a rule
   later?
10. **Etsy buyer email:** leave out (default, data minimization) or include?

### 1.3 Environment note

Outbound access from this working environment to Etsy hosts (`developers.etsy.com`,
`developer.etsy.com`, `www.etsy.com`, and `api.etsy.com`) is blocked by the environment's network
policy. To let me read Etsy's documentation and specification here, add those hosts to the
environment's allowed domains (cloud environment menu, Edit, Network access). Etsy API calls
themselves will be made from the WordPress server, not from here, so this is only needed for
verification work in Step 5. Documentation steps:
<https://code.claude.com/docs/en/cloud-environments#network-access>.

## 2. Decision log

Format: context, decision, consequences. Status for all: **Proposed**.

### ADR-001 — Domain topology

- **Context.** The Stripe plugin, Apple Pay domain registration, and webhooks must all live on a
  host that runs WooCommerce. Next.js is on a different runtime.
- **Decision.** Two hosts: `www` for Next.js, `shop` for WordPress.
- **Consequences.** Apple Pay is registered on `shop`. Cookies are separate, so the cart
  is handed over rather than shared. The WordPress public pages (other than checkout and account)
  are `noindex` or redirected to `www`. A proxy-based single-domain setup is possible later but
  adds routing complexity and risks Apple Pay and cookie issues.

### ADR-002 — Hybrid checkout with the official Stripe plugin

- **Context.** The brief says to use the official plugin unless something is demonstrably better
  supported. No documentation I could reach supports driving the plugin's payment flow from a
  separate frontend.
- **Decision.** Next.js owns browsing and cart; WooCommerce owns checkout and payment status.
  A validated single-use handoff transfers the cart.
- **Consequences.** Minimal payment code of our own; checkout is a themed WooCommerce page rather
  than a Next.js page; wallet buttons are not on `www` pages in v1.
- **Reversal trigger.** Step 3 spikes fail, or the checkout look is rejected at G1/G2. Then
  option C in PAYMENTS §12, after you approve.

### ADR-003 — Etsy sync as a WordPress plugin

- **Context.** Needs: direct WooCommerce CRUD, transactions, a job queue, retries, WP admin
  authorization, and strict isolation from shoppers.
- **Decision.** `kcpw-etsy` plugin using Action Scheduler, driven by system cron.
- **Alternatives.** A separate Node worker: type-sharing with Next.js and process isolation, but it
  needs its own queue, state, and authenticated admin, and would write to WooCommerce through
  REST without transactions.
- **Consequences.** Sync shares the WordPress host with checkout, so load is managed with batch limits,
  concurrency 1, and a load test (R7). Plugin boundary and kill switch keep it removable.

### ADR-004 — Etsy orders as WooCommerce orders

- **Context.** "Import into WooCommerce or a consolidated fulfillment view."
- **Decision.** Import as WooCommerce orders with payment method "Paid on Etsy".
- **Pros.** One queue; packing slips, shipping-label plugins, and exports work unchanged;
  personalization is visible in the same place.
- **Cons and mitigations.** Revenue and tax reports include Etsy sales (filter by source in Step 9);
  customer emails must be suppressed (done by filters and no recipient); stock must not be touched
  by default (rule-driven); refunds must not hit Stripe (gateway without refund support).
- **Alternative.** A separate table and fulfillment page: cleaner reports, but loses the plugin
  ecosystem and duplicates fulfillment UI.

### ADR-005 — Source of truth and field ownership

- **Decision.** Per-field policy (ETSY §7), WooCommerce owns the website, import-once defaults,
  SEO and WooCommerce-specific options never written, three-way conflict detection, preview
  required before apply.
- **Consequences.** More up-front configuration; much lower risk of overwriting SEO copy,
  prices, or variations.

### ADR-006 — Etsy access class and scopes

- **Decision.** Personal access for our own shop; `shops_r`, `listings_r`, `transactions_r` only
  until a write feature is approved; no `listings_d`; `email_r` off by default.
- **Consequences.** Etsy webhooks (commercial apps) are unavailable, so we poll. If personal access
  proves insufficient, we revisit with evidence rather than applying for commercial access
  speculatively.

### ADR-007 — Personalization options

- **Decision.** First-party schema in `kcpw-core` stored in product meta, validated and priced
  server-side, saved as order-item meta.
- **Alternative.** A commercial add-ons plugin: faster to start, but headless JSON exposure and
  server-side pricing control are weaker. If you already use one and it exposes its schema, we
  revisit.

### ADR-008 — Catalog delivery to Next.js

- **Decision.** Purpose-built read endpoints returning a denormalized DTO; the storefront has
  no WooCommerce credentials; tag-based revalidation with a time-based fallback.
- **Alternatives.** WooCommerce REST (N+1 calls for variations, needs credentials), Store API
  (cart-oriented), WPGraphQL (extra stack).
- **Consequences.** We maintain a small API and its contract tests; in return the public data shape is
  controlled and Etsy data cannot leak into it.
