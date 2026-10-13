# Catalog cleanup report: prioritized fixes, risks, and what needs your approval

Date: 2026-10-13. Based on your product export (330 rows), your plugin list (79 plugins), and the code in this repository.
**Nothing on the live site has been changed**: no product, variation, stock setting, category, redirect, plugin, DNS record, Etsy listing, or Stripe setting.
Everything below is a proposal. Each item says what it would change, what could go wrong, how to undo it, and whether it needs your approval (all of the live-site ones do).

## 0. How sure am I? (read this first)

| What I know                                                                                           | How I know it                                       | Confidence |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------- |
| 66 published products, 18 variable, 259 variations; prices, titles, categories, attributes, stock fields | Your export                                         | High       |
| 256 of 259 variations have **blank** attribute values                                                 | Your export                                         | High       |
| Whether those blanks are a real WooCommerce "Any" or lost in the export                               | **Not known.** Needs the live store                | **Unverified** |
| Product URLs, sales history, reviews, which copy Google already knows                                | **Not in the export. Not known.**                   | **Unverified** |
| How buyers enter names today (probably order notes)                                                   | Product wording and the plugin list                 | Inferred   |
| Where SEO text lives (13 custom plugins)                                                              | Plugin descriptions only; I have not seen the code  | Inferred   |

My sandbox cannot reach kcprintworks.com, so I cannot check the "Unverified" rows myself. I built the tools to settle them in minutes, read-only (section 7).

## 1. Priority list

Priority = value to you divided by risk and effort. **P0** is "do first, nothing changes". **P1** is high value and low risk. **P2** is worthwhile but touches more. **P3** is housekeeping.

### P0: settle the facts (no live change)

| #   | Action                                                                                                                                                                                                                                                                                                      | Why                                                                                          | Needs approval?                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0.1 | **Check the variations are really "Any".** Easiest: open product #124 and #889 in WordPress admin, Variations tab, and screenshot one variation's dropdowns. Or run `scripts/discovery/fetch-wc-catalog.mjs --public` (no key, no admin change) and `compare-variations.mjs` (section 7).                      | Every variation decision (bag tag, SKUs, the "Any" model) rests on it. I will not change or delete a variation until this is answered. | No. Reading only. (A read-only API key, if you choose that route, is created by you in WordPress.)   |
| 0.2 | **Pull URLs, sales, and review counts** for the 15 duplicate groups, using the same snapshot (`--rest`, or the key route for sales).                                                                                                                                                                         | Turns the duplicate recommendation from Medium to High confidence.                           | No (the public route has URLs and review counts, not sales; sales need a read-only key).             |
| 0.3 | **Send one order sample** (bag tag or keychain, customer details removed).                                                                                                                                                                                                                                   | Shows how the name arrives today; decides the personalization migration wording.             | No.                                                                                                   |

### P1: high value, low risk

| #   | Fix                                                                                                                                                                                                                                                                                                                              | Risk and how to undo                                                                                                                                                                                                                        | Approval |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1.1 | **Stop counting down fake stock.** 59 products are made to order: turn "Manage stock" **off** (status stays "In stock"). 4 products (#63, #124, #140, #157) track stock **only** on their "+ Deck" variations (decks on hand). 3 need your answer (#561 puzzle, #587 Flip 7 combo, #877 three-case bundle). Detail and per-product CSV: [STOCK-PLAN.md](discovery/STOCK-PLAN.md). | Today 173 counts are exactly 15 and 55 are exactly 20, which are importer defaults, and WooCommerce subtracts one per sale and **blocks sales at zero**. **#440 TACTA has 2 left** and could stop selling after two orders. Risk of change: very low for printed-to-order items. Undo: restore "Manage stock" and the quantities from the export taken first. | **Yes** (inventory settings). Do it on staging first. |
| 1.2 | **Hide marketplace metadata from shoppers** (Condition, Condition Description, MPN, Primary and Secondary color, Occasion, Holiday, Material multi). These show on 52 products and read like internal codes ("i_did", "made_to_order").                                                                                          | **No backend change is needed**: the new storefront simply does not display them, and the data stays in WooCommerce untouched. On the *current* site, changing each attribute's "Visible on the product page" box is a product-data change, and Meta and Google feeds may read some of these attributes. | Storefront: no. Live site: **Yes** (leave it alone unless you want it). |
| 1.3 | **Show real made-to-order messaging** instead of stock. `Condition = made_to_order` already marks 52 products; the storefront turns it into a "Made to order" badge and ignores stock for them.                                                                                                                                | None. It is display logic in the new site. Lead time (days) is **unknown**; I show none until you give it.                                                                                                                                  | No       |
| 1.4 | **Duplicates:** 12 groups have two published copies; 3 more groups are a published product plus an old draft. Recommended keepers (all **Medium** confidence until 0.2): Skip-Bo 124, Phase 10 140, Taco Cat 196 (Low), 3 Up 3 Down 187, Scrabble Slam 228, AAA 265, The Mind 272, 9V 293, AA 300, Clue 388, Vintage Skip-Bo 396, Beat the Heat 410, Chameleon 431, TACTA 440, Monopoly No Mercy 595. Full table: [DUPLICATES.md](discovery/DUPLICATES.md). | Retiring the wrong copy can lose search ranking, reviews, or a URL that Google, Meta, or Klaviyo already uses. Safe sequence per pair: (1) confirm with 0.2, (2) add a 301 redirect from the retired URL to the keeper, (3) unpublish, (4) after 30 days with no traffic to the old URL, trash. **Nothing is merged, deleted, unpublished, or redirected until you approve each group.** Undo: republish the copy and remove the redirect. | **Yes**, per group |

### P2: worthwhile, touches more

| #   | Fix                                                                                                                                                                                                                                                                                                               | Risk and how to undo                                                                                                                                                                                                                                                       | Approval |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2.1 | **Categories.** 50 of 66 products are "Uncategorized". Proposed: Card Game Cases, Board Game Cases, Playing Card & Deck Boxes, Battery & Utility Storage, Gifts Tags & Desk Toys, plus computed collections (New Arrivals, Personalized, On Sale, Bundles). Mapping with the rule behind each placement: [CATEGORIES.md](discovery/CATEGORIES.md) and `category-plan.csv` (fill the `owner_decision` column). | Two custom plugins ("Auto New Arrivals Rotator", "New Arrivals Merchandising") reassign categories by code and would **overwrite a manual cleanup**; they must be reconfigured or retired first. Renaming "Card Games" keeps its URL. The 9mm ammo box (#238) may fall under Meta/Google firearm-related policies; check before including them in feeds. Undo: reassign from the export. | **Yes**  |
| 2.2 | **Bag tag (#889): 169 variations to options.** All 169 are priced the same and blank, so the choice is "13 tag colors x 13 text colors" saved on the order item, not 169 records. Design and fixtures: [PERSONALIZATION.md](PERSONALIZATION.md) section 5.                                                           | Existing orders and any Etsy mapping reference the old variation IDs, so the old product stays until the new one is proven on staging. Reports that group sales by variation lose the 169-way split (you gain a color breakdown from order-item meta). Undo: keep the old product published and switch back. **Depends on 0.1.** | **Yes**  |
| 2.3 | **Personalization saved per order item** (a first-party `kcpw-core` module). Full comparison and rollout: [PERSONALIZATION.md](PERSONALIZATION.md).                                                                                                                                                                | New code on the checkout path, so it is built and tested on staging with Stripe in test mode, with shared test vectors (33) that the PHP side must pass. Undo: disable the module; products fall back to the current behavior.                                                | **Yes** (build on staging) |
| 2.4 | **Titles and descriptions.** Titles run to 127 characters (median 68; 8 over 80) and read like marketplace keyword lists; 66 of 71 short descriptions are empty; descriptions are plain text with line breaks and "•" characters; 18 (the September re-import) still end with the visible text "Listed with ExportYourStore.com".                          | The new storefront already **displays** them cleanly (long titles are clamped on cards, the text is turned into paragraphs, bullet and numbered lists and headings, and the import footer is not shown) without editing a word of the stored text. Rewriting titles changes URLs and SEO: only with your approval, product by product. | Storefront: no. Editing stored text: **Yes** |
| 2.5 | **Variations whose option names sit only in the SKU** (for example `ALIVE-GAME-CASE-NVY`). If 0.1 shows they are truly "Any", a customer can pick any color and every variation matches, so the SKU the warehouse sees is the first match, not the chosen color.                                                | The choice is preserved on the cart line and order in the new storefront (attributes travel with the line). In the **old** checkout the chosen color may not be recorded against a specific variation. Fix is to give each variation its real value (a data change after 0.1).                    | **Yes**  |

### P3: housekeeping

| #   | Item                                                                                                                                                                                                                      | Approval |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3.1 | Two weight outliers: #238 = 5 and #877 = 16 (everything else 0.8 lb). Confirm the unit (Q7); wrong weights change shipping prices.                                                                                          | Yes      |
| 3.2 | **Both WooCommerce Tax and Stripe Tax are active.** Which one calculates tax today? Two can double-count or conflict (Q12).                                                                                                 | Yes      |
| 3.3 | **Updates pending:** WooCommerce 11.1.0 (11.2.1 available), Stripe Gateway 11.0.0 (11.0.1), 12 third-party plugins. Updating production is a live change; do it on staging first.                                         | Yes      |
| 3.4 | A "storewide sale through September 30, 2026" plugin is **still active** on 2026-10-13. Confirm whether sale prices should still apply (Q16).                                                                               | Yes      |
| 3.5 | Plugin debt: three generations of footer-social plugins and overlapping blog-link plugins are all active; 13 custom plugins hold SEO text because no SEO plugin is installed. Plan a consolidation after the new storefront launches (a custom SEO layer moves into the new site's data, not into more plugins). | Yes      |
| 3.6 | Facebook/Meta catalog sync is on for 18 rows and needs reconnecting after the domain move (Q6).                                                                                                                             | Yes      |

## 2. What the new storefront already does about these (no live change)

| Concern                                          | Handled how                                                                                                                                   | Proven by                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Blank ("Any") variation attributes               | Treated as "applies to every option"; the shopper's choice travels with the cart line; never assumed to be one variation per combination      | contracts and storefront tests; e2e                                      |
| 169 variations slow the page                     | The browser gets a compact table with interchangeable rows merged (169 becomes 1, or 4.5 KB instead of 31 KB in the worst case)                  | `purchase-model.test.ts`; e2e payload and script-size budgets            |
| Unnecessary browser JavaScript                   | Page scripts dropped from 645 KB to 532 KB: the validation library (about 115 KB) is gone from every page and only loads on the cart after it renders | e2e budget; a lint rule and a graph test keep it out                     |
| Marketplace attributes visible to shoppers       | Not displayed; left untouched in WooCommerce                                                                                                  | export-catalog tests                                                     |
| Real products in the design preview              | `CATALOG_SOURCE=export` renders your 66 products (titles, prices, options, variation shapes) from the export                                  | `export-catalog.test.ts` (runs on your real export where present)        |

Run the preview yourself: `CATALOG_SOURCE=export npm run dev -w @kcpw/storefront` (needs the export at `docs/discovery/raw/products.csv`, which is gitignored).
Options: `CATALOG_CATEGORIES=current|proposed`, `CATALOG_HIDE_DUPLICATES=1`, `CATALOG_PLACEHOLDER_IMAGES=1`. Product web addresses in the preview are **derived from titles**, because the export has no permalinks.

## 3. Approval matrix

| Change                                           | Touches                  | Staging first? | Rollback                                      | Your approval |
| ------------------------------------------------ | ------------------------ | -------------- | --------------------------------------------- | ------------- |
| Read-only snapshot of the live catalog           | Nothing (GET requests)   | n/a            | n/a                                           | Not needed (key creation is yours) |
| Stock management off, 59 products                | Live inventory settings  | Yes            | Restore from export                           | **Required**  |
| Retire duplicate copies (redirect, unpublish)    | Live products, SEO       | Yes            | Republish, remove redirect                    | **Required, per group** |
| Re-categorize products; change New Arrivals plugins | Live categories, plugins | Yes         | Reassign from export; re-enable plugins       | **Required**  |
| Bag tag 169 variations to options                | Live product, orders mapping | Yes        | Keep the old product published                | **Required**  |
| Edit variation values, titles, descriptions      | Live product data        | Yes            | Restore from export                           | **Required**  |
| Personalization module                           | New plugin on checkout   | Yes (test mode) | Disable the module                            | **Required**  |
| Plugin updates, tax plugin changes               | Live site                | Yes            | Plugin rollback                               | **Required**  |
| Deploy the storefront container to the VPS       | The VPS only             | It is staging  | `./deploy.sh --rollback`                      | You run it    |
| DNS, Nginx Proxy Manager host, Stripe webhooks, Etsy scopes | External systems | n/a   | n/a                                           | **Required**  |

## 4. Risks to keep in view

1. **Redirects and SEO.** Any URL change without a 301 loses rankings. The duplicate and title work is where this bites.
2. **Order history.** Orders reference product and variation IDs. Replacing the bag tag product or deleting a duplicate with orders breaks reports; keep, unpublish, redirect.
3. **Code-driven catalog.** Custom plugins rewrite categories, wording at render time, and stock display. A "clean" product record can still display differently on the live site (and differently from the new one). I have not seen their source (Q10).
4. **Feeds.** Meta and Google read attributes and categories. Changing them can drop products from ads. Check feeds before and after.
5. **Unknown automation.** Many plugins list "Hermes" or "Helper" as author; if something still edits the live site automatically (Q15), it can undo a manual cleanup.
6. **A read-only key is still a key.** If you choose the REST route, create it with **Read** permission only, delete it after the snapshot, and never paste it into a chat.

## 5. Your decisions, in the order that unblocks the most

1. **Q1 (P0):** screenshot of the Variations tab for #124 and #889, or run the public snapshot (section 7).
2. **Stock (1.1):** which items do you ever print ahead and shelve; are the "+ Deck" options a deck you buy; #561, #587, #877?
3. **Duplicates (1.4):** accept, change, or hold each keeper (the CSV has a decision column).
4. **Icons and cable colors (PERSONALIZATION.md section 6).**
5. **Order sample (Q3), Etsy API key (Q11), tax plugin (Q12), PayPal (Q13), Cloudflare (Q14), "Hermes" (Q15), free-shipping threshold and the sale plugin (Q16), blog and pages (Q17).** See [PLUGINS.md](discovery/PLUGINS.md) and [INVENTORY.md](discovery/INVENTORY.md) for the exact wording of each question.

## 6. Where everything is

| Deliverable                                  | File                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| This report                                  | `docs/CATALOG-CLEANUP.md`                                                                                                  |
| Inventory and findings                       | [discovery/INVENTORY.md](discovery/INVENTORY.md), [discovery/PLUGINS.md](discovery/PLUGINS.md)                             |
| Duplicates                                   | [discovery/DUPLICATES.md](discovery/DUPLICATES.md), `duplicate-recommendations.csv`                                        |
| Stock                                        | [discovery/STOCK-PLAN.md](discovery/STOCK-PLAN.md), `stock-plan.csv`                                                       |
| Categories                                   | [discovery/CATEGORIES.md](discovery/CATEGORIES.md), `category-plan.csv`                                                    |
| Personalization                              | [PERSONALIZATION.md](PERSONALIZATION.md), `packages/contracts/test/vectors/options.json`                                   |
| Deployment to the VPS                        | [DEPLOYMENT-VPS.md](DEPLOYMENT-VPS.md)                                                                                     |

## 7. The read-only tools

```bash
# 1. Snapshot the live catalog (GET requests only; writes one JSON file under docs/discovery/raw/, which is gitignored)
node scripts/discovery/fetch-wc-catalog.mjs --public --base https://kcprintworks.com --out docs/discovery/raw/rest-products.json
#    richer (drafts, sales, review counts), with a READ-ONLY key you create in WordPress, typed into your own terminal:
#    WC_BASE_URL=https://kcprintworks.com WC_CONSUMER_KEY=... WC_CONSUMER_SECRET=... node scripts/discovery/fetch-wc-catalog.mjs --out docs/discovery/raw/rest-products.json

# 2. Are the blanks a real "Any"?
node scripts/discovery/compare-variations.mjs docs/discovery/raw/products.csv docs/discovery/raw/rest-products.json

# 3. Re-run the keeper report with URLs, sales, and reviews
node scripts/discovery/duplicate-report.mjs docs/discovery/raw/products.csv --rest docs/discovery/raw/rest-products.json --csv docs/discovery/duplicate-recommendations.csv
```

These are tested against mock responses; they have **not** been run against your live site (my environment cannot reach it), and the Store API response shapes are from its documentation,
so expect to confirm them on the first real run. Each tool refuses to send credentials over plain http, never follows redirects with credentials, never requests orders, customers, or reviewer details, and cannot send anything but GET.
