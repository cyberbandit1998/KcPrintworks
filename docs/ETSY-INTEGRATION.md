# Etsy Integration (Open API v3)

Status: **approved architecture** (2026-10-13); Etsy specifics still pending verification against
Etsy's official documentation. Shop: <https://kcprintworks.etsy.com>.

> **Verification note (updated 2026-10-13).** Etsy's developer site (`developers.etsy.com`,
> `developer.etsy.com`), help center (`help.etsy.com`), API hosts, and the Etsy Dev MCP server
> endpoint are all blocked by the network policy of the environment this plan was written in
> (DNS fails or the proxy returns 403), and no Etsy MCP connector is attached to the session. I
> therefore **could not read Etsy's current reference, terms, or specification**. Etsy-specific
> facts below come from the owner's statements, search-result excerpts of Etsy's pages, and my own
> knowledge. Each is tagged in §16 as **Confirmed**, **Owner-stated**, **Reported** (third-party or
> community), or **To verify**. Step 5 verifies every non-confirmed item against the official
> OpenAPI spec (via the Etsy Dev MCP server, §2.1) before code depends on it.

## 1. Principles and capability phases

1. **Read-only first.** The initial release requests read scopes only.
2. **WooCommerce is master for the website.** Etsy data enters under an explicit per-field policy.
3. **Preview, then apply.** No Woo change happens without a stored preview that you approved.
4. **No silent overwrites in either direction.** Conflicts are surfaced, not resolved by whoever
   wrote last.
5. **Never on a public request.** All Etsy calls run in background jobs or in admin-initiated actions.
6. **Draft-only writes later, each with approval.** Live Etsy listings are never published or
   overwritten automatically.

| Phase | Capability | Etsy scopes | Release |
|---|---|---|---|
| R0 | Connect, snapshot listings, import preview, matching | `shops_r`, `listings_r`, `transactions_r` | v1 |
| R1 | Apply product sync under field policy | same | v1 |
| R2 | Import Etsy orders, decrement stock for stock-managed items | same | v1 |
| W1 | Push shipment tracking to Etsy | adds `transactions_w` | After launch, on approval |
| W2 | Push stock/price to Etsy | adds `listings_w` | After launch, on approval |
| W3 | Create Etsy **draft** listings from WooCommerce products | `listings_w` | After launch, on approval |
| W4 | Update existing listings | `listings_w` | After launch, per-listing approval |

`listings_d` (delete) is never requested. Buyer email scope (`email_r`) is off by default (§10).

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
- **Read-only guard:** until a write feature is explicitly enabled, the client throws on any
  non-GET request. Enabling writes requires all three of: the `KCPW_ETSY_WRITES_ENABLED` constant,
  the granted write scope, and an unconsumed approval record for the specific action.
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

### 6.1 Explicit mappings

Stored in the tables in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-data-model):

- **Listing level:** Etsy listing ID ↔ WooCommerce product ID.
- **Variant level:** Etsy inventory product ID (and offering ID) ↔ WooCommerce variation ID,
  with a normalized hash of the Etsy property values.
- **SKU:** stored on both levels as a matching aid, used only where unique on both sides.
- **Orders:** Etsy receipt ID ↔ WooCommerce order ID; Etsy transaction ID ↔ order item ID.

Each mapping row carries its `match_method` (`manual`, `sku`, `stored_id`, `suggested_confirmed`),
who confirmed it and when. **Product titles are never a key.**

### 6.2 Matching tiers

| Tier | Signals | Behavior |
|---|---|---|
| 1. Existing | Mapping row already present, or a stored Etsy listing ID in WooCommerce meta | Verified and kept |
| 2. High confidence | Exact SKU unique across both catalogs, at product or variant level | Proposed link; applied only after you approve the preview (bulk approval allowed once you have approved the first run) |
| 3. Suggested | Normalized title similarity above threshold **and** a corroborating signal (price within tolerance, image match) | Shown as a suggestion only; never auto-applied |
| 4. Unmatched | Nothing credible | Listed in the Unmatched queue |

Duplicates are never created automatically: an unmatched Etsy listing becomes a **draft**
WooCommerce product only if you choose "Create" for it in the preview, and it is never published to
the storefront without your action. Duplicate SKUs on either side block auto-linking and raise a
warning.

### 6.3 Variation mapping

Etsy variations are a list of products, each with up to two property dimensions (for example
Size × Color), a SKU, and an offering with price and quantity *(To verify)*. WooCommerce variations
use attributes. Mapping is by normalized (property, value) pairs to attribute terms, shown as a grid
where each Etsy product points to a WooCommerce variation. Ambiguous cases go to the manual grid. **Variation structure is never
altered automatically after the first approved import;** a structural difference raises a conflict.

### 6.4 Manual matching tool

Search WooCommerce by name, SKU, or ID next to the Etsy listing detail (images, SKUs, price,
variations); pick a match, map each variation, then "Confirm". Also: "Ignore this listing"
(excluded from future previews), "Unlink", and "Create new product (draft)".

## 7. Field ownership

Each field has an **owner policy**. Defaults are conservative; changes to defaults are made in the
UI (global or per product) and logged.

| Field | Default policy | Behavior |
|---|---|---|
| Etsy listing ID, inventory/offering IDs | Etsy-owned, immutable | Written to mapping tables |
| Title | **Import once**, then Woo-owned | Seed on creation; later Etsy changes shown as informational drift |
| Description | **Import once**, then Woo-owned | Protects website SEO copy |
| SEO fields (title tag, meta description, slug, canonical, schema) | **Woo-owned, never written** | Not touched by the importer |
| Categories, tags, WooCommerce-specific options (personalization schema, add-ons) | **Woo-owned, never written** | Not touched |
| Images | **Import once**, then Woo-owned | New Etsy images are flagged, not added; Woo-added images are never removed. Deduped by Etsy image ID and file hash |
| Website price | **Woo-owned** | Independent from Etsy |
| Etsy price | Etsy-owned, stored separately | Admin-only; never exposed on the storefront. Drift shown as information |
| SKU | Import if empty in Woo; otherwise Woo-owned | Conflicts flagged |
| Variation structure | Import once, then Woo-owned | Structural mismatch is a conflict |
| Listing state (active, inactive, sold out, draft, expired) | Etsy-owned, stored on the mapping | Shown in admin. Optional policy "flag"; auto-hiding products in Woo is off by default |
| Availability / stock | Per-product **inventory rule** (§12) | Default `made_to_order`: no stock management, nothing synced |

Price policy values: `independent` (default, only one implemented in v1), plus reserved
`markup_percent`, `fixed_delta`, `etsy_master`, `woo_master` for later.

### 7.1 Conflict detection (three-way)

For each field under an "Etsy → Woo" policy, the mapping stores the **base hash** (value at last
sync). On the next run:

- Etsy unchanged since base → nothing to do.
- Etsy changed, Woo unchanged since base → update proposed in the preview.
- Etsy changed **and** Woo changed → **conflict**: not applied; shown with both values for a decision
  (keep Woo, take Etsy, or ignore).

Conflict warnings visible in the UI include: title or description changed on both sides; Etsy price
drift versus the stored value; variation structure mismatch; duplicate SKU; mapped Etsy listing
now deleted or expired; Woo product in trash.

## 8. Import preview and apply

1. **Snapshot.** A job fetches listings, inventory, and images into `kcpw_etsy_listing_snapshot`.
   Nothing in WooCommerce changes.
2. **Plan.** The planner compares the snapshot with WooCommerce under the field policy and writes a
   plan to `kcpw_sync_plan`. Each item: entity, action (`create_draft`, `link`, `update`, `skip`,
   `conflict`), target IDs, and field-level diffs showing before, after, owner, and reason.
   Plan items carry the Etsy `updated_timestamp` they were based on.
3. **Review.** The admin screen filters by action and confidence, and lets you tick items.
   Nothing is pre-ticked in the first run.
4. **Apply** consumes a plan ID and a plan hash. Items whose Etsy source changed since the preview, or whose Woo target changed,
   are marked `stale` and skipped until re-previewed.
5. **Execution** runs in batches via Action Scheduler (about 25 items per batch), is resumable,
   and writes every field change to `kcpw_sync_change` with prior values.
6. **Undo.** "Revert run" restores prior values for fields that have not been changed since.
   Created draft products are moved to trash rather than deleted.
7. **Image import** uses WordPress sideloading with MIME checks, stores the Etsy image ID in
   attachment meta for dedupe, sets alt text from the title, and preserves Etsy image order.

Scheduled syncs after the first apply **refresh snapshots and generate a new plan**. They apply
only changes that your standing rules mark as automatic; by default, nothing is auto-applied
and the plan waits for review.

## 9. Product synchronization scope

Listing ID, name, description, images, price (stored as Etsy price), SKU, variations (property
values, per-variation SKU, price, quantity), availability, listing state, and attributes. Mapped
to the Woo fields per §7. Etsy tags and materials are imported as product attributes only if you
enable it. Personalization settings on the listing (whether personalization is on, whether it
is required, character limit, instructions) are read to **pre-fill a suggested option schema**
for the WooCommerce product; they are never auto-activated.

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

## 12. Inventory synchronization

Many KCPrintWorks items are made to order, so stock sync is **opt-in per product or variation**.

| Rule | Meaning |
|---|---|
| `made_to_order` (**default**) | WooCommerce stock management off; Etsy quantity ignored; nothing synchronized |
| `woo_master` | WooCommerce quantity is authoritative; Etsy quantity is reported against it (push to Etsy only in W2) |
| `etsy_master` | Etsy quantity is authoritative; imported into WooCommerce stock |
| `shared_pool` | One stock pool decremented by sales on either channel |

Design rules:

- **Events over absolutes.** For `shared_pool`, each sale is applied as a delta to the other channel,
  and periodic reconciliation compares absolute quantities and reports drift beyond a tolerance
  instead of overwriting. Only an explicit master rule auto-corrects.
- **Safe direction first.** Etsy → Woo (from imported receipts) uses read scopes only and ships in
  v1. Woo → Etsy requires W2.
- **Etsy inventory write semantics.** Updating inventory appears to replace the full set of
  products *(Reported)*. W2 must therefore read the current inventory, modify only the intended
  fields, show a diff, and write back all other fields unchanged. A shadow mode logs the intended
  write without sending it, before W2 is ever enabled.
- **Oversell risk** when both channels sell the last unit simultaneously: mitigate with a configurable safety buffer; alert when stock reaches zero.
- A change to Etsy variations or stock never changes WooCommerce price or variation structure.

## 13. Admin interface (WordPress admin, WooCommerce → Etsy Sync)

Built with `@wordpress/components` and the WordPress REST API; capability- and nonce-protected;
WCAG 2.2 AA.

| Screen | Contents |
|---|---|
| **Dashboard** | Connection status (connected / needs re-auth / disconnected), shop name, granted scopes, token expiry (no secrets), last successful sync per job, counts (listings seen, matched, unmatched, conflicts, ignored), recent errors, API quota meter, kill switches, **Sync now** (per job; runs a preview for products) |
| **Products** | Table with filters (matched, suggested, unmatched, conflict, ignored, error), search by title/SKU/ID; row detail with Etsy and Woo side by side; variation mapping grid; match, unlink, ignore, create draft |
| **Import preview** | The plan from §8 with filters, tick boxes, diffs, stale markers, **Apply selected** |
| **Field policy** | Global and per-product ownership, price policy, state policy; shows what each setting would change |
| **Conflicts** | Open conflicts with both values and decision buttons |
| **Orders** | Imported receipts, Woo order links, needs-attention queue, mismatches |
| **Inventory** | Rules per product/variation; drift report |
| **History** | Runs and per-field changes, filters, export CSV, **Revert run** |
| **Settings** | Schedules, thresholds, alert recipients, scope upgrade requests (disabled until approved), required Etsy attribution |

Accessibility specifics: real tables with headers and captions; every control labelled; full keyboard
operation; visible focus; status uses icon plus text; progress and results announced via `aria-live`
regions; respects reduced motion; tested with axe-core and manual screen-reader checks.

## 14. Future publishing design (not built in v1)

- A **PublishPlan** is generated from a WooCommerce product: title, description, tags,
  materials, taxonomy, images, variation properties and offerings, price per variation, quantity,
  shipping profile, processing profile, and maker disclosures. Etsy's required fields and limits
  (title length, tag count and length, image count, variation limits) are validated before approval
  *(limits To verify against the vendored spec)*.
- State machine: `planned → validated → awaiting_approval → approved → executed`. **Executed means
  a draft was created.** The plugin never sets a listing to active; publishing (which incurs listing
  fees) is done by you in Etsy.
- Image upload is idempotent (Etsy image IDs recorded).
- Updating an existing listing requires a per-listing diff and approval, and stores a snapshot of the
  prior Etsy state first.
- Every write is rate-limit aware, logged, undoable where Etsy allows, and gated by the three conditions in §4.
- Etsy's seller and listing policies (maker and AI disclosures, handmade or made-to-order rules)
  remain your responsibility; the plan surfaces fields Etsy requires.

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
| Shop contents (listing count, variations, personalization use) | **Unknown** | Shop not reachable from here |

Sources reached (none of Etsy's own pages could be opened directly): Etsy's `open-api` repository ([README](https://github.com/etsy/open-api),
[#1509](https://github.com/etsy/open-api/discussions/1509),
[#1663](https://github.com/etsy/open-api/discussions/1663)) and web search results summarizing Etsy's
developer documentation. Etsy's own pages were not reachable (see the note at the top).
