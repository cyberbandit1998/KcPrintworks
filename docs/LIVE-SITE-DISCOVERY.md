# Live Site Discovery (read-only)

Purpose: learn what the current WordPress/WooCommerce install at `kcprintworks.com` actually contains
**before** choosing a personalization approach, finalizing the migration plan, or writing the product
data mapper.

Why this is a procedure for you instead of something I ran: the working environment I use cannot reach
`kcprintworks.com` (blocked by network policy; DNS lookups fail), so I could not inspect the installed
plugins myself. Nothing here installs software, edits settings, or changes the site. Everything is a
screen you look at, a file you export, or a request to a public URL.

**Never send me**: passwords, API secret keys (Stripe `sk_`/`rk_`, WooCommerce `cs_`), database
credentials, `wp-config.php`, or customer personal data. Redact names, emails, and addresses from order
examples. Raw dumps go under `docs/discovery/raw/` (gitignored); only a reviewed, redacted summary is committed
to `docs/discovery/INVENTORY.md`.

## Progress

- **2026-10-13: product export received and analyzed** (section 1.2). Findings, with the questions they raise:
  [discovery/INVENTORY.md](discovery/INVENTORY.md). Re-run the analysis on any newer export with
  `node scripts/discovery/analyze-wc-export.mjs docs/discovery/raw/products.csv`.
- Still outstanding: everything in 1.1, 1.3, 1.5, 1.6, 1.7, plus the **Variations-tab check** below.

## 1. Checklist

### 1.1 Plugins, theme, and platform (5 minutes)

- [ ] **Tools → Site Health → Info → "Copy site info to clipboard".** Gives WordPress, PHP, database,
      server, active theme, and every active/inactive plugin with versions. It does not include passwords.
      Paste the result to me or save it as `docs/discovery/raw/site-health.txt`.
- [ ] **WooCommerce → Status → "Get system report".** Gives WooCommerce version, HPOS state, template
      overrides, enabled gateways, and settings. Safe to share (review for emails first).
- [ ] **Plugins → Installed Plugins:** screenshot if Site Health is unavailable.

### 1.2 Products and variations (10 minutes)

- [x] **Products → Export**, all columns, **"Export custom meta" ticked**, all products (received 2026-10-13). This is the
      single most useful file: it shows attributes, variations, SKUs, prices, stock settings, and
      the meta keys any personalization plugin writes. Contains no customer data.
- [ ] **Variations tab check (new, from the export analysis):** open products **#124 (Skip-Bo)** and **#889 (bag tag)**,
      go to Product data → Variations, and screenshot a few variations with their dropdowns open. In the export, 256 of 259
      variations had blank attribute values, which WooCommerce treats as "Any"; this shows whether that is real or an
      export quirk.
- [ ] Open **one personalized product** in the editor and screenshot the personalization settings (the
      plugin's tab or meta box). Do the same for any global add-on groups.
- [ ] Share the **public URL** of that product and one variable product.

### 1.3 How personalization lands in orders (10 minutes)

- [ ] Open **3 to 5 recent orders that contain personalization**, including one with two different
      personalized items and one with quantity above 1. Screenshot the line-item area (redact customer
      details). This shows the exact item-meta labels and values saved today.
- [ ] Tell me, per product, whether personalization is **once per line item** or **once per unit** when
      quantity is above 1.

### 1.4 Quick public-page checks (run on your own computer)

These are read-only requests to your own public pages. Any can be skipped.

```bash
# Plugin directories referenced by the public product page
curl -s https://kcprintworks.com/product/YOUR-PRODUCT-SLUG/ \
  | grep -o 'wp-content/plugins/[^/"?]*' | sort -u

# REST namespaces advertised by the site (plugins often add their own)
curl -s https://kcprintworks.com/wp-json/ | python3 -c "import sys,json; print('\n'.join(json.load(sys.stdin)['namespaces']))"

# Upload folders that hint at customer file uploads (a 403/404 is normal and fine)
curl -sI https://kcprintworks.com/wp-content/uploads/woocommerce_uploads/ | head -1
```

### 1.5 Payments, webhooks, and integrations

- [ ] **WooCommerce → Settings → Payments:** which methods are enabled; for Stripe, the **mode (test/live)**
      and the displayed webhook URL (not the keys).
- [ ] **Stripe Dashboard → Developers → Webhooks:** list of endpoint URLs and event counts (screenshot; no secrets).
- [ ] **WooCommerce → Settings → Advanced → REST API and Webhooks:** names, permissions, "last access", and delivery URLs
      (never the keys/secrets).
- [ ] Any external tools connected (shipping, accounting, Zapier, marketplace tools, email marketing).
- [ ] Premium plugins and their **license/domain terms**.

### 1.6 Hosting, DNS, SSL, email

- [ ] Hosting provider, plan, control panel, PHP version options, memory limit, WP-CLI availability
      (`wp --info` over SSH if any), cron job list, staging feature.
- [ ] **DNS zone export** from the DNS provider (or screenshots of all records) and the nameservers.
- [ ] Certificate issuer and expiry (browser padlock → certificate).
- [ ] Where email is hosted; which plugin/service sends WooCommerce emails.
- [ ] Any CDN, Cloudflare, or caching plugin; any security plugin or host WAF.
- [ ] Custom `.htaccess` redirect rules; `robots.txt`; the SEO plugin in use and its sitemap URL.

### 1.7 Etsy side

- [ ] Approximate listing count, how many have variations, which use Etsy's personalization box.
- [ ] Etsy Shop Manager data download for listings (the CSV export under shop settings; confirm the exact menu name on Etsy).
      Contains your own listing data only.
- [ ] Whether you already have a registered Etsy developer app (the Seller App eligibility rule mentions
      that an existing registered app matters).

## 2. How I will use it

### 2.1 Personalization: decision criteria

I will not choose a solution until the inventory above exists. When it does, I evaluate the plugin (or
custom code) actually in use against these questions:

| # | Question | Why it matters for a headless storefront |
|---|---|---|
| 1 | Does it store the field definitions as structured data (product meta, a custom post type, or its own tables) that I can read? | The Next.js product page must render the same fields without scraping HTML |
| 2 | How does it read customer input on add-to-cart: from `$_POST` field names, or through a filter with explicit parameters? | Our handoff builds the WooCommerce cart server-side, so it must feed the plugin the same input the plugin's own form would |
| 3 | Does it validate server-side (required, max length, allowed choices)? | Client-only validation is bypassable; we need server enforcement either way |
| 4 | Does it compute price adders server-side in the cart? | Totals must come from WooCommerce, never from the browser |
| 5 | Does it save readable **order item meta** (label and value)? | Required: "per-item personalization details stored in the order" |
| 6 | Is it HPOS compatible, maintained, and compatible with the move to `shop.` (license/domain terms)? | Long-term safety |
| 7 | Does it support any file-upload fields? | Only then do upload requirements enter the scope |

Possible outcomes, decided with you after reviewing the evidence:

| Outcome | When | Consequence |
|---|---|---|
| **A. Keep the existing plugin; add a thin read adapter and a handoff adapter in `kcpw-core`** | Questions 1 to 5 are satisfied | No re-entry of product configuration; the existing order format is preserved; the adapter is the main risk and gets its own test suite |
| **B. Migrate to the first-party schema in `kcpw-core`** | The plugin hides its schema, cannot be driven from a server-side cart build, or is unmaintained | A one-time converter with a **read-only preview** first; the old plugin stays active during the transition |
| **C. Hybrid** | Some products use simple variation attributes, others need free text | Both paths behind the same storefront DTO |

Whichever outcome applies, these invariants hold:

- The storefront DTO exposes a **plugin-agnostic option schema** (field type, label, required, limits,
  choices, price effect for display). The Next.js UI renders from that schema only. This is why
  Step 1 can proceed before the plugin is known.
- Every personalized cart line becomes its **own order line item** (the line key includes a hash of the
  options), so two different personalizations of the same product never merge.
- Each order line stores (1) human-readable item meta for admin, emails, and packing slips, and (2) a
  normalized hidden record (`_kcpw_personalization`: schema version, field IDs, labels, values, and a
  validated flag) for reliable fulfillment, reports, and parity with imported Etsy orders.
- Server-side validation and pricing are mandatory; the tamper suite in PAYMENTS §11.5 runs against the
  chosen approach.
- **No upload feature is built or assumed** unless 1.2, 1.3, or the upload-folder check show that existing
  products use it. If they do, the requirements in PAYMENTS §5 (MIME verification, size limits,
  non-public storage, random names, admin-only access) apply before launch.

### 2.2 Variation preservation

The requirement is that **all existing variations are preserved**. The plan to prove it:

1. From the product export, record per product: variation count, attributes, SKUs, regular/sale price,
   stock settings, images, and status. This is the baseline.
2. The database is carried over by cloning, not re-created, so variation records are untouched.
3. A **variation parity report** (Step 2) compares baseline, the staging database, and what the
   storefront DTO emits. Any mismatch fails CI.
4. The Etsy sync never alters variation structure after the first approved import (ETSY §6.3, §7).

### 2.3 Other uses

The inventory feeds the redirect map and URL parity (MIGRATION §5), the API/webhook inventory
(MIGRATION §6, §7), host constraints (MIGRATION §10), Etsy matching (SKU quality), and the Step 1
design (real categories, real product types, real copy).

## 3. Inventory template

Save the redacted result as `docs/discovery/INVENTORY.md` using these headings:

```
# Live Site Inventory (redacted)
Date collected / by whom:
## Platform         WordPress, WooCommerce, PHP, DB, HPOS, theme, host, panel
## Plugins          name | version | active | purpose | HPOS-compatible | license/domain-bound
## Catalog          product count | variable products | variations total | stock-managed | categories
## Personalization  plugin/code | storage location | per-line or per-unit | validation | price effects | uploads (yes/no)
## Orders           item-meta keys and example (redacted)
## Payments         gateways | Stripe mode | webhook URLs | other
## Integrations     REST keys | webhooks | external tools | licenses
## Hosting/DNS/SSL  provider | PHP | memory | cron | WP-CLI | WAF | DNS provider | nameservers | MX | CAA | cert issuer
## SEO              plugin | sitemap URL | custom redirects | permalink structure
## Etsy             listing count | variations | personalization use | existing developer app (y/n)
## Open questions
```
