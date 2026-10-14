# Etsy Integration (Open API v3): Etsy is the master catalog

Status: **owner decision 2026-10-14 ([ADR-013](DECISIONS.md#adr-013--etsy-is-the-master-product-catalog-owner-decision-2026-10-14))**. Products are created and edited
on Etsy; they flow **Etsy -> `kcpw-etsy` -> WooCommerce -> Next.js**. WooCommerce keeps checkout, shipping, tax, and the official Stripe plugin.
Shop: <https://kcprintworks.etsy.com>.

> **What exists today, and what does not.** The WordPress plugin `wordpress/kcpw-etsy/` (v0.1.0, read-only) has the Seller App connection (OAuth 2.0 with PKCE),
> a rate-limit-aware GET-only Etsy client, an encrypted token vault, a listing downloader, the product **matching report** with owner decisions, and a
> **dry-run planner** that says what a sync would change. It has **no code that creates, updates, or deletes a WooCommerce product, variation, price, stock level,
> category, image, or order**, and none that writes to Etsy; a test scans for both. The first synchronization (the "apply" step) is **not built** and needs the
> owner's approval after reviewing the matches and the dry-run. Everything is tested against **mock Etsy responses**, never against the real shop (see the note below).
>
> | Capability | State |
> |---|---|
> | Seller App connection (PKCE, encrypted tokens, rotation-safe refresh, "Test connection" that diffs real responses against the expected shapes) | **Built**, untested against real Etsy |
> | Listing download (listings, inventory, images, personalization settings) into a private snapshot table | **Built**, untested against real Etsy |
> | Matching report with CSV, owner decisions (link / ignore / create new), no auto-linking of ambiguous matches | **Built**; tested on the real WooCommerce export for duplicate handling |
> | Dry-run planner (field policy, overrides, price and inventory policy, three-way conflicts, variation matching, personalization suggestion) | **Built** |
> | Admin screens: Connection (status, test), Preview (matches, newly seen listings, decisions), Plan (dry-run) | **Built** (last-run status shown; failure list and manual download button included) |
> | Apply the first synchronization, change log, rollback | **Designed (section 8), not built.** Needs owner approval |
> | Scheduled background sync, Etsy webhooks | **Designed (sections 8, 11), not built.** A once-a-day read-only download exists behind a `wp-config.php` constant |
> | Order import (`order.paid`) | **Designed (section 10), later phase** |
> | Writing to Etsy | **Not planned.** Etsy is the master; the only candidate is tracking numbers (W1), on separate approval |

> **Verification note (updated 2026-10-14).** Etsy's developer site (`developers.etsy.com`, `developer.etsy.com`), help center (`help.etsy.com`), API hosts, and the Etsy Dev
> MCP server endpoint are blocked by the network policy of the environment this was written in (DNS fails or the proxy returns 403), and no Etsy MCP connector is
> attached. I therefore **could not read Etsy's current reference, terms, or specification**, and the plugin has **never talked to Etsy**. Etsy-specific facts (endpoints,
> field names, headers, token lifetimes) come from the owner's statements, search-result excerpts of Etsy's pages, and my own knowledge, and are tagged in section 16 as
> **Confirmed**, **Owner-stated**, **Reported**, or **To verify**. The plugin's *Test connection* screen is the first real check: it compares Etsy's actual responses with what the
> code expects and lists every difference. Nothing may be applied before that has been run against the real shop and the differences resolved.

## 1. Principles and capability phases

1. **Etsy is the source of truth** for title, description, images, variations, colors, and base prices (section 7). WooCommerce is the website's projection of it.
2. **Read-only toward Etsy, always.** Only read scopes are requested; the HTTP layer refuses any request that is not a GET or the OAuth token call.
3. **Nothing changes in WooCommerce without a stored dry-run that the owner approved.** The live store stays unchanged until the first synchronization is approved.
4. **No duplicates.** Linking comes before creating; every ambiguous match is decided by the owner; titles are never a key.
5. **No silent overwrites in either direction.** A website-side edit to an Etsy-owned field is a *conflict* or an *approved override*, never "last writer wins".
6. **Never on a public request.** Etsy is called only from background jobs and admin actions. The storefront has no Etsy credentials and no Etsy code (`npm run guard`).
7. **Reversible.** Every applied change records the prior value; a run can be reverted field by field where the target has not changed since.

| Phase | Capability | Etsy scopes | State |
|---|---|---|---|
| E0 | Connect the Seller App, test connection, download listings | `shops_r`, `listings_r` | **Built** |
| E1 | Matching report, owner decisions, dry-run plan | same | **Built** |
| E2 | **First synchronization** (apply approved plan to WooCommerce, staging first), change log, rollback | same | Needs owner approval; not built |
| E3 | Scheduled background sync (every 6 h plus nightly full), webhooks as a trigger where available | same | Not built |
| E4 | Import Etsy orders as WooCommerce orders (section 10) | adds `transactions_r` | Later |
| W1 | Push shipment tracking to Etsy | adds `transactions_w` | Only on separate approval |

`listings_w` and `listings_d` are **never** requested: with Etsy as master there is no WooCommerce-to-Etsy publishing (the old W2 to W4 phases are dropped, section 14).
Buyer email (`email_r`) stays off (section 10).

## 2. Access and app registration

- The Etsy developer app must be registered **by you** under your Etsy account; I cannot and should
  not do this. Registration is the longest external lead time and is outside our control, so I
  recommend submitting it early (during Step 2) even though the build order in your brief puts the
  work at Step 5.
- **Access class: Seller App (Seller API Access).** You report that Etsy introduced Seller API
  Access in July 2026 for sellers connecting their own shops. Etsy's help-center article "How to
  Register a Seller App with Etsy's API" is consistent with this: in the excerpt I could see, a
  Seller App has access to all public and OAuth-authenticated endpoints, scoped only to the
  registered shop; it cannot be used to reach other sellers' shops or to build an application for
  the broader seller community; eligibility is an active shop in good standing with no existing
  registered app; and approval is typically quick. That is exactly our use case, so **we register a
  Seller App and do not apply for Commercial Access.** This supersedes the earlier "personal access"
  plan (ADR-006). Open points to confirm on the real page: current rate limits for Seller Apps, the
  exact scope list, and what happens if you already have a registered app (the eligibility rule
  above suggests an existing app must be dealt with first).
- Keep the app description accurate and within the form's limits. The app may only ever be used with
  the KCPrintWorks shop; the integration is never offered to other sellers.
- **Webhooks:** you report that webhooks are available beyond commercial-only applications. The
  official webhooks page, as excerpted in search results, lists `order.paid` and requires a valid
  OAuth 2.0 token with suitable scopes plus a public HTTPS callback; it does not state which access
  tiers qualify. Third-party summaries say subscriptions are managed in the Developer Portal's
  webhook portal. We therefore design for **`order.paid` webhook as the fast path and polling as
  the recovery mechanism** (§10.1, §10.5): correctness never depends on a webhook arriving.
- Use `https://` redirect URIs registered exactly: one for staging, one for production
  (`https://shop.kcprintworks.com/wp-json/kcpw-etsy/v1/oauth/callback`, proposed).
- Etsy's terms may require attribution and restrict data use. Review the current API Terms of Use
  before launch (launch gate), and include any required attribution in the admin screen.
- **Fallback if API access is denied or delayed:** the same import-preview pipeline accepts Etsy
  Shop Manager CSV exports (listings and orders) through an adapter, so Steps 6 to 9 are not
  blocked on approval. CSV lacks inventory product IDs, so matching relies on listing ID and SKU.

### 2.1 Using Etsy's official Dev MCP server for specifications

Etsy publishes a Dev MCP server whose tools are derived from the Etsy OpenAPI specification. Search
results give its endpoint as `https://mcp.api.etsycloud.com/mcp` (the sample config in the excerpt
omitted the scheme, so check the page) and say it provides five tools; a third-party review
describes it as a **documentation and schema server, not a data-access interface** (API calls still
need OAuth). It is not attached to this session and the host is blocked here, so it has not been used
yet.

Plan for Step 5, in a development environment with network access:

1. Add the server to Claude Code's MCP configuration (a command of the form
   `claude mcp add --transport http etsy <url-from-Etsy-page>`; confirm syntax and URL on Etsy's
   "Dev MCP Server" page first).
2. Use it to answer every "To verify" row in §16 and record the answer, the date, and the tool used.
3. Download the OpenAPI document it is derived from and **vendor it** into
   `wordpress/plugins/kcpw-etsy/spec/` (dated filename). Contract tests and a weekly drift check
   run against that file, so later sessions do not depend on the MCP server being reachable.
4. The MCP server never receives our OAuth tokens or shop data, and no token is ever pasted into an
   AI assistant session.

## 3. Authentication and token lifecycle

- **OAuth 2.0 authorization code with PKCE (S256).** Authorization at
  `https://www.etsy.com/oauth/connect`; token exchange and refresh at
  `https://api.etsy.com/v3/public/oauth/token`.
- Connect is an admin action: capability check, `state` bound to the admin session, code verifier
  held server-side for 10 minutes, exchange done server-side. The browser never sees tokens.
- **Token facts:** access tokens last about 1 hour and refresh tokens about 90 days *(Reported
  and partially Confirmed; see §16)*. Treat the refresh token as **rotating**: persist the new
  one atomically before using the new access token.
- **Refresh:** a scheduled check every 30 minutes refreshes tokens that expire within 15 minutes,
  and the API client refreshes once on a 401. A single-flight lock prevents two jobs refreshing at
  once.
- **Failure:** `invalid_grant` or revoked access sets the connection to `needs_reauth`, pauses all
  jobs, shows a banner, and sends one alert. Jobs do not loop on a dead token.
- **Storage:** libsodium-encrypted at rest; encryption key in a `wp-config.php` constant;
  client ID/secret in constants or env. Never logged or returned by any API. "Disconnect" deletes
  stored tokens and revokes them if the API supports it.
- **Scope upgrades** (W-phases) require a new consent flow. The UI shows granted scopes and offers
  "Request write access" only when the feature gate is open and an approval is recorded.

## 4. API client rules

- Single PHP client class; base URL `https://api.etsy.com/v3/application`; request timeout 15 s.
- API key header: `x-api-key`. Etsy may now require the shared secret in this header
  (`keystring:secret` form) *(To verify)*; header construction lives in one method.
- **Read-only guard (built):** `ReadOnlyTransport` allows only `GET` under the API base URL and the single OAuth token `POST`, over https with no embedded credentials; anything else throws
  `WriteBlocked` before a socket is opened, and `Scopes` can only ever request `shops_r`, `listings_r`, `transactions_r`. There is currently **no switch** that enables writes. If a write
  (W1) is ever approved it would be a new code path requiring all three of: a `wp-config.php` constant, the granted write scope, and an unconsumed approval record for the specific action.
- **Rate limits:** Etsy enforces per-key queries-per-second and queries-per-day limits, with
  response headers `x-limit-per-second`, `x-remaining-this-second`, `x-limit-per-day`,
  `x-remaining-today`; the daily window is rolling over 24 hours *(Confirmed from Etsy docs
  excerpt)*. Published numbers for new apps vary by source, so we read the app's real limits from
  the developer portal and the response headers.
  - Client-side limiter spaces calls to stay under QPS.
  - **Daily budget:** jobs stop at 80% of `x-limit-per-day` and keep 20% for manual actions.
  - Counters persisted so they survive restarts.
- **Errors:** 429 → honor `Retry-After` if present, otherwise exponential backoff with jitter. 5xx
  and timeouts → retry up to 5 times (1 m, 5 m, 15 m, 1 h, 3 h). Other 4xx → no retry; mark the item
  failed with the response code. Circuit breaker opens after 5 consecutive upstream failures and
  half-opens after a cooling period.
- Use `includes` (images, inventory) on listing reads to reduce call counts *(To verify)*. Page
  with `limit=100`.
- Logs: method, path template, status, duration, remaining quota, run ID. No tokens, no PII.

## 5. Endpoints used (to verify against the vendored OpenAPI spec)

| Purpose | Endpoint (v3, `/application`) | Scope | Phase |
|---|---|---|---|
| Resolve user and shop | `GET /users/me`, `GET /shops/{shop_id}` | `shops_r` | R0 |
| List listings by state | `GET /shops/{shop_id}/listings?state=…` | `listings_r` | R0 |
| Listing detail | `GET /listings/{listing_id}` | `listings_r` | R0 |
| Inventory (products, offerings, SKUs, property values) | `GET /listings/{listing_id}/inventory` | `listings_r` | R0 |
| Images | `GET /listings/{listing_id}/images` | `listings_r` | R0 |
| Receipts | `GET /shops/{shop_id}/receipts` | `transactions_r` | R2 |
| Receipt transactions | included in receipt or `GET …/receipts/{id}/transactions` | `transactions_r` | R2 |
| Post tracking | `POST /shops/{shop_id}/receipts/{receipt_id}/tracking` | `transactions_w` | W1 |
| Update inventory | `PUT /listings/{listing_id}/inventory` | `listings_w` | W2 |
| Create draft, upload image | `POST /shops/{shop_id}/listings`, `POST …/listings/{id}/images` | `listings_w` | W3 |

## 6. Mapping model and matching

### 6.1 Explicit, permanent mappings

- **Listing level:** Etsy listing ID <-> WooCommerce product ID, stored as product meta `_kcpw_etsy_listing_id`. The plugin **reads** this key today (so a mapping made later is
  honored at once); it is **written** only by the first approved synchronization (E2).
- **Variant level:** Etsy inventory product ID <-> WooCommerce variation ID, meta `_kcpw_etsy_product_id` on the variation (read today, written at E2). Existing WooCommerce variation
  IDs are **kept**, so carts, orders, and the storefront's variation IDs do not change.
- **SKU:** a matching aid, trusted only where it is unique on both sides.
- **Orders (later):** Etsy receipt ID <-> WooCommerce order ID; Etsy transaction ID <-> order item ID.

Each mapping records how it was made (`stored_id`, `sku`, `image`, `owner_decision`) and who confirmed it. **Product titles are never a key.**

### 6.2 How the matcher decides (built, `src/Match/Matcher.php`)

Every Etsy listing is compared with every WooCommerce product and given **signals**:

| Signal | Strength | Meaning |
|---|---|---|
| `stored_id` | strong | The product already stores this Etsy listing ID |
| `listing_id_in_sku`, `product_id_in_sku` | strong | A SKU contains the Etsy listing ID or inventory product ID |
| `sku_exact` | strong | Same SKU, unique on both sides |
| `image_id` | strong | The product's photo file name carries an Etsy image ID (`il_fullxfull.<id>_<hash>`) |
| `title_exact`, `title_similar`, `description_similar`, `price_equal` | weak | Textual similarity only |

Result per listing (a status the admin shows in plain words):

| Status | When | What happens |
|---|---|---|
| `mapped` | A stored ID points at an existing product | Kept |
| `proposed` | Exactly one strong candidate and no look-alike twin; or no strong signal but one product with a matching title **and** description | Shown for approval; **never applied by itself** |
| `ambiguous` | Two or more candidates, or one strong candidate **plus an identical-looking twin** (WooCommerce already holds duplicate imports) | Needs the owner to pick one product, or "ignore", or "create new". The suggestion is *published first, then lowest ID* and is only a suggestion |
| `new` | No credible candidate | Would become a **draft** product after the owner chooses "create new" |
| `approved`, `approved_new`, `ignored` | The owner's saved decision | Used by the planner; decisions are stored separately and change nothing in WooCommerce |

A product can be claimed by only one listing; a second claim is reported (`claimed_by_other_listing`) instead of silently reusing it. A decision that points at a
product that no longer exists is reported as invalid, not applied.

### 6.2.1 What the existing WooCommerce catalog tells us

From the owner's product export ([discovery/INVENTORY.md](discovery/INVENTORY.md)), observed 2026-10-13:

- The catalog appears to be derived from Etsy (attribute values use Etsy's `made_to_order` and `i_did` vocabulary, Etsy-style fields such as Primary color, Occasion, Holiday), but
  **no Etsy listing IDs or URLs are stored**. There is nothing to read an existing link from; every link is created by matching.
- SKUs are present on every variation and unique. 181 rows use a `<9 to 12 digit number>_<suffix>` pattern (12 distinct numbers; all 169 variations of one product share one).
  These may be marketplace IDs (**unverified**); the matcher compares them with Etsy listing IDs and inventory product IDs once connected.
- **WooCommerce already contains duplicates:** 15 groups (32 products) share a title; 12 groups have two or more published copies. One Etsy listing maps to at most one product, so
  the report lists "one Etsy listing, several candidate products" and never picks a winner. A test runs the matcher over the real export (a synthetic Etsy snapshot built from the
  products) to prove duplicates are reported as ambiguous. The owner decides; the losing copy is later redirected, not deleted by this plugin.
- Variation attribute values are blank for 256 of 259 variations ("Any"), so a variation does not say which option it represents. Variation matching therefore uses the WooCommerce variation
  ID stored in meta, SKUs, a product ID embedded in a SKU, and option values, in that order; a blank "Any" variation that must become a specific one is flagged **high risk** and keeps its ID.
- Stock quantities are mostly defaults (15 or 20). Etsy quantities are not trusted as inventory for made-to-order items (section 12).

### 6.3 Variation mapping

Etsy variations are a list of products, each with up to two property dimensions (for example Size x Color), a SKU, and an offering with price and quantity *(To verify)*. WooCommerce
variations use attributes. The planner matches Etsy products to existing variations as described above, shows a grid of the proposed pairs, and **never alters variation structure
automatically after the first approved synchronization**; a structural difference becomes a conflict.

### 6.4 Owner decisions

On the Preview screen (or in the downloadable CSV) the owner picks, per ambiguous listing, one of: link to a named product, ignore this listing, or create a new draft product.
Saved decisions are stored in the plugin's own table (`kcpw_etsy_decision`); saving them touches nothing in WooCommerce. CSV cells that start with `=`, `+`, `-`, or `@` are prefixed
so a spreadsheet cannot run them as formulas.

## 7. Field ownership (Etsy is master)

Each field has an **owner**. Defaults follow ADR-013; the owner can change them globally or per product, and every change is logged.

| Field | Owner | Behavior |
|---|---|---|
| Etsy listing ID, inventory/offering IDs | Etsy, immutable | Written to the mapping |
| **Title** | **Etsy** | Etsy changes flow to WooCommerce after approval. A website-side edit is a conflict, or an approved override that survives later syncs |
| **Description** | **Etsy** | Same. Compared as plain text, so reformatting alone is not a change |
| **Images** | **Etsy** | Added, reordered, and removed to follow Etsy, deduplicated by Etsy image ID. Images added only on the website are listed, not deleted, until the owner decides |
| **Variations, colors, options** | **Etsy** | Option names and values follow Etsy; **existing WooCommerce variation IDs are kept**. A structural difference is a conflict. "Any" variations are never rewritten silently |
| **Base price** | **Etsy** | Etsy's price is stored; the **website price** is derived by the price policy (below) |
| Website address (slug), SEO title, meta description, canonical | WooCommerce | **Never written.** Existing product URLs do not change |
| Categories, tags | WooCommerce | **Never written.** Etsy taxonomy is shown for information only |
| Shipping class / rules, tax class | WooCommerce | **Never written** (Etsy's shipping profiles do not apply to the website) |
| Personalization schema (storefront fields) | Derived, then WooCommerce | Etsy's personalization settings produce a **suggested** schema (sections 9 and 12); it is never activated without approval |
| Stock / availability | Inventory policy (section 12) | Default `made_to_order`: Etsy quantity is ignored |
| Listing state (active, inactive, sold out, draft, expired) | Etsy, stored with the mapping | Shown in admin and flagged; a product is hidden on the website only if the owner enables that rule |
| Approved overrides | WooCommerce, per field per product | A recorded owner decision ("keep my website title for this product"); the planner reports the field as `skipped_override` |

**Price policy** (per product, default = Etsy price as is; integer cents, half rounded away from zero): `etsy` (website price equals Etsy), `markup_percent`, `fixed_delta`, `fixed` (an
independent website price that Etsy changes never touch). The dry-run shows both prices.

### 7.1 Conflict detection (three-way, built in the planner)

For each Etsy-owned field the mapping stores the **base hash** (the value at the last synchronization). On the next plan:

- Etsy unchanged since base -> nothing to do (`in_sync`).
- Etsy changed, WooCommerce unchanged since base -> `change`, proposed in the dry-run.
- Etsy changed **and** WooCommerce changed -> `conflict`: not applied, both values shown for a decision (take Etsy, keep website as an override, ignore).
- Etsy unchanged, WooCommerce changed -> `website_edit`: reported so the owner knows the website has drifted from Etsy.
- An approved override on the field -> `skipped_override`.

Before the first synchronization there is no base, so every difference is a `change` and every field the website has already edited is highlighted for review.

## 8. Preview, dry-run, apply, rollback

1. **Download** (built). A background-safe, resumable job fetches listings, inventory, and images into the plugin's snapshot table. WooCommerce is only *read*.
2. **Match** (built). The matching report (section 6) and the owner's decisions.
3. **Dry-run plan** (built). For every matched or approved listing the planner lists, per field, `before`, `after`, owner, risk (`low`, `medium`, `high`), and the reason, plus
   draft creations for approved-new listings and flags for anything it cannot represent. The plan is a stored, hashed document: it describes, it does not write.
4. **Owner review** (built UI for matches and the plan; approval controls come with E2). Nothing is pre-approved. **No WooCommerce change happens before the owner approves the
   first synchronization.**
5. **Apply** (E2, **not built**). Consumes a plan ID and hash. An item whose Etsy source or WooCommerce target changed since the dry-run is marked `stale` and skipped until re-planned.
   Execution is batched, resumable, and writes every field change with its prior value to a change log. Product *creation* is as a **draft**. Images are sideloaded with MIME checks and
   deduplicated by Etsy image ID.
6. **Rollback** (E2, **not built**). "Revert run" restores prior values for fields that have not changed since; created drafts are trashed, never hard-deleted.
7. **Staging first.** The first apply runs on a staging copy of the WooCommerce site, is compared against the dry-run, and only then is the same plan proposed for the live store.

Scheduled syncs (E3) refresh the snapshot and generate a **new plan**; they apply only changes that standing rules mark as automatic, and by default nothing is auto-applied.

## 9. Product synchronization scope

In scope once approved: title, description, images, variations (property values, per-variation SKU, price, availability), base price, listing state, and the Etsy IDs. Etsy tags and
materials are imported as product attributes only if the owner enables it.

**Personalization.** Etsy's per-listing settings (personalization on/off, required, character limit, instructions) are read and turned into a **suggested** storefront option schema
(text field with the Etsy limit and instructions as help text). It is shown in the dry-run as a `suggestion`, never auto-activated, and the storefront validates every value server-side
against the schema before it is saved on the order item (ADR-007 invariants; [PERSONALIZATION.md](PERSONALIZATION.md)). Etsy's personalization is a single free-text box per listing;
structured fields such as separate tag, text, and cable colors come from Etsy *variations* when the listing uses them, and from the WooCommerce-side schema otherwise.

## 10. Order synchronization

**Approach: import each Etsy sale as a WooCommerce order** (HPOS), flagged as an externally paid
Etsy order. WooCommerce becomes the single fulfillment queue for both channels. Alternative
(separate store, not an order) is recorded in ADR-004.

### 10.1 Pipeline

Two triggers feed **one idempotent importer**:

- **Fast path:** the `order.paid` webhook (§10.5) enqueues `import_receipt(receipt_id)`.
- **Recovery path:** a polling job lists receipts with a creation watermark and an overlap window,
  plus a status refresh for open (unshipped) receipts so cancellations and shipments update. Polling
  runs whether or not webhooks work; only its cadence changes (§11.1).

The importer:

1. Takes a per-receipt lock, then inserts into `kcpw_etsy_order_map` with **UNIQUE
   (shop_id, receipt_id)**. If the insert fails, the receipt is already imported and only a
   status update is applied. This makes imports safe against concurrency, webhook retries, webhook
   plus poll races, and re-runs.
2. Always fetches the receipt from the Etsy API itself (the webhook body is never trusted as data).
3. Creates the WooCommerce order inside a database transaction; on failure, rolls back the map row.

### 10.5 `order.paid` webhook handler

Etsy's webhook payloads are thin: event type, a resource URL, and the shop ID, with no order data
*(Reported; GitHub discussion #1509)*. Signature scheme as reported there (it follows the Standard
Webhooks convention; confirm on Etsy's page in Step 5):

| Item | Design |
|---|---|
| Route | `POST /wp-json/kcpw-etsy/v1/webhooks/etsy`; public route (no WordPress auth) protected only by signature verification; `Cache-Control: no-store`; excluded from page cache, bot challenges, and WAF challenge rules |
| Headers | `webhook-id`, `webhook-timestamp`, `webhook-signature` (value like `v1,<base64>`, possibly several space-separated signatures during secret rotation) |
| Verification | Over the **raw request body**: `HMAC-SHA256(key, "{webhook-id}.{webhook-timestamp}.{raw-body}")` where the key is the base64-decoded part of the `whsec_…` secret after the prefix; compare base64 output with `hash_equals`; accept if any listed `v1` signature matches |
| Replay protection | Reject timestamps more than 5 minutes from server time; store `webhook-id` in `kcpw_webhook_event` (unique) and treat repeats as already handled |
| Secret | `KCPW_ETSY_WEBHOOK_SECRET` constant in `wp-config.php`; never in the database, logs, or git |
| SSRF guard | **Never fetch `resource_url` as given.** Parse it, require host `api.etsy.com`, a path matching our shop's receipt endpoint, and our `shop_id`; extract the receipt ID and fetch through our own API client |
| Response | `401` bad signature or stale timestamp; `200` for valid events including duplicates; `5xx` only if we could not persist the event (so Etsy retries); response within a couple of seconds, with all real work done in the queued job |
| Unknown events | Ignored with `200` and logged (future events such as shipped/canceled can be adopted later) |

**Webhook health and recovery**

- Every polled receipt that arrives without a prior webhook within 15 minutes of its creation
  counts as a **webhook miss**. The dashboard shows the miss rate and last webhook received time.
- Poll cadence is adaptive: 10 minutes by default, relaxed to 30 minutes while webhooks have been
  healthy for 24 hours (no misses), and returned to 10 minutes immediately on a miss or a webhook
  gap longer than the expected quiet period. The daily reconciliation (7-day lookback) always runs.
- Early community reports describe missing deliveries and signature problems, so the system is
  built to assume webhooks are an optimization. Alerts fire on repeated misses, not on a single one.
- Subscribing the endpoint happens in Etsy's Developer Portal and is done by you; I give you the
  exact URL and secret handling steps then.
- Staging registers its own endpoint and secret; production's secret is never reused.

### 10.2 Mapping Etsy receipt to WooCommerce order

| Etsy | WooCommerce |
|---|---|
| Receipt ID | Order meta `_kcpw_etsy_receipt_id` plus map table; order number prefix `ETSY-` shown in admin |
| Transaction ID, listing ID, product ID | Item meta; item linked to the mapped product/variation when a mapping exists |
| Quantity, line price | Line item quantity and totals (set explicitly from Etsy amounts) |
| Variations and **personalization** | Item meta with readable labels matching the website's personalization labels |
| Buyer note, gift message | Order customer note and meta |
| Shipping name and address | Shipping and billing address (as permitted by API access) |
| Buyer email | **Not imported by default** (needs `email_r`; data minimization). Order has no customer email, so no WooCommerce customer emails can be sent |
| Receipt payment status and totals | Meta `_kcpw_etsy_payment_status`, plus tax/shipping/discount totals |
| Shipment status, carrier, tracking | Order status (`completed` when shipped) plus note and meta |
| Source | `created_via = etsy`, meta `_kcpw_source = etsy` |

Money: Etsy returns amounts as integer `amount` with `divisor` and `currency_code` *(To verify)*.
All math is integer-based; no floating point. If the receipt currency differs from the store
currency, the order is held for review rather than converted.

### 10.3 Rules that prevent mistakes

- **Externally paid:** payment method `kcpw_etsy` titled "Paid on Etsy"; paid date set from Etsy; status
  `processing` for unshipped paid receipts, `completed` for shipped ones, `cancelled` for canceled.
  This gateway is **not available at checkout**, supports no refunds, and **can never create a Stripe
  charge**. A test asserts that no code path creates a PaymentIntent for an order with this
  method.
- **No customer emails** for Etsy orders (WooCommerce email filters, plus no recipient address).
- **No tax recalculation:** totals are written as Etsy reported them. Etsy collects and remits
  marketplace sales tax where applicable, so WooCommerce must not add its own.
- **Stock:** reduced only if the item's inventory rule says so (§12). Never by default.
- **Unmapped items:** the sale is still imported (as a free-text line item with Etsy title, SKU, and
  IDs) and the order is flagged *Needs attention* so nothing is dropped.
- **Analytics:** Etsy orders are marked so website revenue reports can exclude them. WooCommerce
  Analytics treats them as orders by default; the reporting filter is part of Step 9 (risk R8).
- **Refunds and cancellations on Etsy:** applied as status changes plus notes, with no gateway call.
- **Privacy:** store only fulfillment data; retention per policy; erased with the WooCommerce
  privacy tools.

### 10.4 Shipping status

v1 is one-way (Etsy → WooCommerce): staff mark orders shipped in Etsy and the status flows in.
Pushing tracking from WooCommerce to Etsy is phase W1 and needs `transactions_w`.

## 11. Scheduling, retries, logging

### 11.1 Jobs (Action Scheduler recurring actions)

| Job | Cadence | Notes |
|---|---|---|
| `import_receipt` | on `order.paid` webhook | Fast path (§10.5); idempotent |
| `orders_sync` | every 10 min; 30 min while webhooks are healthy | Recovery path: watermark plus 48 h overlap; refreshes open receipts |
| `orders_reconcile` | daily, 7-day lookback | Every Etsy receipt has exactly one Woo order; reports webhook misses |
| `listings_snapshot` | every 6 h; full nightly | Plan generated, not applied (§8) |
| `inventory_reconcile` | hourly, only for rule-bearing items | Reports drift |
| `token_refresh` | every 30 min | See §3 |
| `log_prune` | daily | Retention 90 days |

### 11.2 Execution model

- WP-Cron loopback is disabled (`DISABLE_WP_CRON`); system cron runs the Action Scheduler runner via
  WP-CLI every minute with a concurrency limit of 1. This keeps sync work off shopper-facing PHP
  workers. If the host does not allow cron, fall back to a single low-concurrency async runner
  and treat it as a launch risk.
- Each job holds a lease lock with a TTL, processes small time-boxed batches, and saves a cursor to
  resume.
- **Retries:** transient failures reschedule with the backoff in §4. After the final attempt the item is `failed`,
  and the run continues with other items (poison items do not block the queue). Permanent errors
  are not retried.
- **Kill switches:** `KCPW_ETSY_ENABLED`, "Pause all sync" in the UI, per-job toggles, and the circuit
  breaker.

### 11.3 Logging and alerts

Structured run and event logs in the database (90 days), WooCommerce logger for debug detail.
Alert (email, one digest per hour at most) on: `needs_reauth`, three consecutive failed runs,
overdue job, daily quota above 80%, unmapped sale imported, order total mismatch.

## 12. Inventory policies

Many KCPrintWorks items are 3D printed to order, so an Etsy quantity of 0 or a stale number must never make a printable item "out of stock" on the website.

| Policy | Meaning |
|---|---|
| `made_to_order` (**default**) | WooCommerce stock management off, availability "in stock"; Etsy quantity is ignored |
| `etsy_quantity` | Etsy's quantity is imported into WooCommerce stock for that product/variation (read-only toward Etsy) |
| `woo_managed` | WooCommerce owns stock; Etsy quantity is shown in the dry-run for information only |

The policy is per product (and per variation where needed). The dry-run shows the effect before anything is applied; a listing Etsy reports as sold out or inactive under `made_to_order`
is **flagged**, not hidden. Stock is only reduced by imported Etsy orders (phase E4) and only when the policy says so. Writing quantities back to Etsy is not planned (Etsy is master).

## 13. Admin interface (WordPress admin, WooCommerce > Etsy sync)

Capability- and nonce-protected (`manage_woocommerce`; every action is POST + nonce, checked in a fixed order and tested with a fake gateway); WCAG-minded plain HTML tables and forms.

| Screen | Built | Contents |
|---|---|---|
| **Connection** | yes | Connected / needs re-authorization / not connected, shop name, granted scopes, token expiry (never the token), **Connect with Etsy**, **Test connection** (compares real responses with the expected shapes), Disconnect |
| **Import preview** | yes | Last download (phase, start and finish, listings / details / failed, Etsy requests left today, the latest problems), **Download Etsy listings now**, the matching report: matched products, proposed and ambiguous matches with candidates and evidence, **listings that have no WooCommerce product yet**, decision selectors, CSV and JSON downloads |
| **Dry-run plan** | yes | Field-by-field before/after, owner, risk, conflicts, website edits, skipped overrides, suggestions; nothing here writes |
| History, rollback, approve-and-apply, field-policy editor, scheduling | E2/E3 | Not built |

The Etsy API quota meter, per-job toggles, and alert e-mails from the original design come with the scheduled jobs (E3).

## 14. Publishing to Etsy: dropped

The earlier design (WooCommerce product -> Etsy draft listing) is **removed**: with Etsy as the master catalog the data only flows toward WooCommerce. If the owner ever wants a write,
the only candidates are shipment tracking (W1, `transactions_w`) and, much later, anything else would need a new ADR and a separate scope consent. The client already refuses non-GET
requests, and the three-condition gate for enabling writes (constant, granted scope, approval record) described in section 4 remains the rule for any future exception.

## 15. Test strategy

- **Contract tests** against the vendored OpenAPI spec and sanitized recorded fixtures.
- **Unit tests** for matching, three-way merge, money math, and plan hashing.
- **Idempotency:** import the same receipt three times and concurrently → exactly one order.
- **Resilience:** simulated 429, 5xx, timeouts, token expiry, `invalid_grant`.
- **Isolation chaos test:** block egress to Etsy during an end-to-end test purchase and browse; the shop
  and the Stripe flow must pass unchanged.
- **Safety invariants:** no non-GET request is sent while writes are disabled; no PaymentIntent for
  Etsy orders; apply never touches fields owned by Woo.
- **Staging soak:** at least 7 days of read-only sync against the real shop before launch.
- **As built (2026-10-14):** `npm run test:php` runs 106 tests / 5,610 assertions with no dependencies: OAuth/PKCE and token rotation, the vault, the Etsy client (quota, retries, error shapes),
  the normalizer, the collector, the matcher (including a run over the real WooCommerce export), the planner and policies, the admin actions via a fake gateway (capability, nonce, method, order of checks),
  WordPress-glue stubs, and `ReadOnlySafetyTest`, which fails if any source file contains a WooCommerce write, a mutating product method, a non-GET request, or a write scope.
  What these cannot prove: real Etsy responses and a real WordPress/WooCommerce runtime (database stores, SQL, hooks). Those are verified on staging with *Test connection* and a first download.

## 16. Verification status

| Claim | Status | Basis |
|---|---|---|
| Per-key QPS and rolling-24h QPD limits; headers `x-limit-per-second`, `x-remaining-this-second`, `x-limit-per-day`, `x-remaining-today`; limits visible per app in the developer portal | **Confirmed** | Etsy rate-limit documentation as quoted in search results |
| Actual limits for our app (sources cite 5/s–10/s and 5k–10k/day for new apps, and 150/s and 100k/day as an example) | **To verify** | Read from the developer portal after registration |
| OAuth 2.0 code flow with PKCE; endpoints above | **Reported** | Multiple third-party guides and my own knowledge |
| Access token ≈ 1 h; refresh token ≈ 90 days; refresh rotation | Refresh 90 days: **Confirmed** (via a search excerpt of Etsy's docs); 1 h and rotation: **Reported** | Etsy docs excerpt plus third-party guides |
| Scope names `shops_r`, `listings_r`, `listings_w`, `transactions_r`, `transactions_w`, `email_r` | **Reported** | Multiple guides; full list not read |
| **Seller API Access / Seller App** introduced July 2026 for sellers connecting their own shop | **Owner-stated** | Your message. Etsy help-center article "How to Register a Seller App with Etsy's API" exists (title seen in search results) |
| Seller App: access to all public and OAuth endpoints, scoped to the registered shop only; cannot serve other sellers; eligibility is an active shop in good standing with no existing registered app; approval typically quick | **Reported** (excerpt of Etsy help center via search; not read in full) | Verify on the real page in Step 5 |
| Commercial Access requires a Personal App first plus manual review; community reports of bans after commercial requests | **Reported** (community) | GitHub discussion #1663; irrelevant to us if the Seller App is used |
| Webhooks available beyond commercial-only apps | **Owner-stated** | Your message; Etsy's page (excerpt) is silent on tiers; third-party summaries say commercial. Verify in the portal |
| Webhook event `order.paid` exists; requires OAuth token with suitable scopes and a public HTTPS callback | **Confirmed** (excerpt of Etsy's webhooks page via search) | |
| Thin payloads; headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; `v1,` signature prefix; HMAC-SHA256 over `id.timestamp.body`; `whsec_` secret base64-decoded; exponential-backoff retries | **Reported** | GitHub discussion #1509 (commenters; docs inconsistencies noted there) |
| Other events (`order.canceled`, `order.shipped`, `order.delivered`) | **Reported** | Search excerpt of the webhooks page; conflicts with #1509 which says `ORDER_PAID` only at launch |
| Etsy Dev MCP server (`https://mcp.api.etsycloud.com/mcp`, five tools, derived from the OpenAPI spec) is a documentation/schema server | **Reported** | Search excerpt of Etsy's "Dev MCP Server" page plus a third-party review |
| `x-api-key` format requiring `keystring:secret` | **To verify** | My recollection only |
| Receipt, transaction, listing, and inventory field names; money object shape | **To verify** | From my own knowledge of the v3 schema; vendored spec decides |
| Inventory `PUT` replaces the entire inventory | **Reported** | Third-party reference |
| Draft-listing required fields; image and tag limits | **To verify** | Sources disagree |
| No Etsy sandbox exists | **To verify** | My recollection only |
| Buyer-data usage and attribution terms | **To verify** (legal review) | Current terms not retrievable here |
| Shop contents (listing count, variations, personalization use) | **Unknown** | Shop not reachable from here. The WooCommerce catalog (71 products, 259 variations) is known from the owner's export, not the Etsy shop |
| Whether the 9 to 12 digit numbers in WooCommerce SKUs are Etsy IDs | **To verify** | Inferred from their shape only; compare with listing/product IDs once connected |
| Mock-based plugin tests prove behavior on real Etsy and WordPress | **No** | `npm run test:php` uses fake transports, stores, and a WordPress stub. Real Etsy, WooCommerce, and database behavior are **unverified** until run on staging |
| Etsy personalization is one free-text box per listing (on/off, required, character limit, instructions) | **To verify** | From my recollection of the listing schema; *Test connection* shows the real fields |
| Listing `state` values (`active`, `inactive`, `sold_out`, `draft`, `expired`) | **To verify** | Same |
| Image file names embed an Etsy image id (`il_fullxfull.<id>_<hash>`) | **Reported** | Seen in the export's image URLs; used as a strong matching signal only when it equals a downloaded image id |

Sources reached (none of Etsy's own pages could be opened directly): Etsy's `open-api` repository ([README](https://github.com/etsy/open-api),
[#1509](https://github.com/etsy/open-api/discussions/1509),
[#1663](https://github.com/etsy/open-api/discussions/1663)) and web search results summarizing Etsy's
developer documentation. Etsy's own pages were not reachable (see the note at the top).
