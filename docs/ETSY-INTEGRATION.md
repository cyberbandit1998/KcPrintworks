# Etsy and the synchronization service

Status: **superseded by [ADR-014](DECISIONS.md#adr-014--woocommerce-is-the-source-of-truth-the-sync-service-is-external-and-interchangeable-owner-decision-2026-10-14) (2026-10-14).** This file used to hold a large design for a custom Etsy
integration (OAuth, an API client, field ownership, previews, order import, publishing). **That is not being built.** The owner
keeps the existing arrangement:

```
Etsy ──> a third-party sync service (ExportYourStore today, possibly Nembol later) ──> WooCommerce ──> this project
```

## What this project does about Etsy

**Nothing.** There is no Etsy API call, Etsy credential, Etsy OAuth flow, or Etsy webhook anywhere in what we ship, and no reference to
a sync product. WooCommerce is the single source of truth for the website's products, prices, variations, and order data; the sync
service is just one of the things that writes to it. `npm run guard` fails the build if shipped code ever mentions Etsy's API hosts,
an Etsy credential, or a sync product by name.

What the storefront needs from WooCommerce, what it ignores, and how to switch services safely:
**[SYNC-INDEPENDENCE.md](SYNC-INDEPENDENCE.md)**.

## History (so nobody wonders where it went)

- 2026-10-13: a read-first custom Etsy sync was planned (ADR-003 to ADR-006, ADR-010).
- 2026-10-14 (morning): the owner decided Etsy would be the master catalog, and a read-only `kcpw-etsy` WordPress plugin was built
  (Seller App OAuth, listing download, matching report, dry-run planner; 106 tests) but **never installed anywhere**.
- 2026-10-14 (afternoon): the owner chose to keep using a sync service instead. The plugin and its documents were removed.
  They remain in git history: `git show 29cc10f:wordpress/kcpw-etsy` and `git show 29cc10f:docs/ETSY-INTEGRATION.md`.

Ideas in that history that may still be useful if a need appears: matching Etsy listings to WooCommerce products by listing id, SKU, and
photo file id before creating anything (to avoid duplicates), and treating a duplicate's twin as "ambiguous" rather than picking one.
The duplicate report for the current catalog is in [discovery/DUPLICATES.md](discovery/DUPLICATES.md) and is based on the product export, not on Etsy.
