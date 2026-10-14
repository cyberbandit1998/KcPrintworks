# KCPrintWorks Etsy Sync (read-only preview)

Version 0.1.0. A WordPress plugin that connects the KCPrintWorks Etsy shop with **read-only** access, downloads its listings,
and shows which WooCommerce products they match and what a synchronization would change.

**In this version the plugin cannot create, change, or delete any WooCommerce product, variation, price, stock level, category,
image, or order, and it cannot write anything to Etsy.** This is enforced three ways: the code contains no such calls (a test scans
for them), the HTTP layer refuses any request that is not a GET read or the OAuth token call, and only read scopes can be requested.
The first synchronization is a later release and needs your explicit approval.

## What it writes (and where)

| Where | What | Removed on uninstall |
|---|---|---|
| Option `kcpw_etsy_tokens` | Etsy access and refresh tokens, **encrypted** with a key from `wp-config.php` | Always |
| Options `kcpw_etsy_settings`, `kcpw_etsy_run_state`, `kcpw_etsy_schema_version` | shop id and name, last connection test, progress of the last download | Always |
| Table `wp_kcpw_etsy_snapshot` | a copy of your Etsy listings, inventory, and images (JSON) | Unless `KCPW_ETSY_KEEP_DATA` is true |
| Table `wp_kcpw_etsy_decision` | your match decisions (link, ignore, new) | Unless `KCPW_ETSY_KEEP_DATA` is true |
| Transients, WP-Cron events | the short-lived OAuth state; the next background download step | Always |

It reads WooCommerce products through WooCommerce's own getters. Nothing else in the database is touched.

## Install (do this on a staging copy of the site first)

Installing any plugin changes the site it is installed on, so install it on staging unless you have decided otherwise.

1. Plugins > Add New > Upload Plugin > choose `kcpw-etsy.zip` (built by CI: see the "Build Etsy plugin" job's artifact, or `npm run build:etsy-plugin`). Activate it. WooCommerce must be active and PHP must be 8.1 or newer.
2. In your Etsy developer account, register a **Seller App** for the KCPrintWorks shop. Copy its API key (keystring). Register the redirect address shown on the plugin's Connection screen **exactly** as the app's callback URL.
3. Add to `wp-config.php` (never to the database, and never paste these anywhere):

```php
define('KCPW_ETSY_API_KEY', 'your-etsy-api-keystring');
define('KCPW_ETSY_ENC_KEY', 'a-long-random-string-of-32-or-more-characters');
// Only if Etsy requires the shared secret as part of the key header ("keystring:secret"):
// define('KCPW_ETSY_SHARED_SECRET', '...');
// define('KCPW_ETSY_SEND_SECRET', true);
// Optional: a daily background download of your listings (reads only):
// define('KCPW_ETSY_AUTO_REFRESH', true);
```

4. WooCommerce > Etsy sync > **Connect with Etsy**, approve the read-only permissions, then **Test connection**. The test compares Etsy's real responses with what this plugin expects and names every difference.
5. **Import preview** > Download Etsy listings now. When it finishes, review the matches, choose a product for each ambiguous listing, and Save decisions. Download the CSV if you prefer to decide in a spreadsheet.

## Uninstall

Deactivate and delete the plugin from the Plugins screen. Tokens, settings, and scheduled events are removed. Add `define('KCPW_ETSY_KEEP_DATA', true);` before deleting to keep the snapshot and your decisions.

## Development

```bash
php wordpress/kcpw-etsy/tests/run.php            # all tests (no dependencies)
php wordpress/kcpw-etsy/tests/run.php Matcher    # tests whose name contains "Matcher"
php wordpress/kcpw-etsy/bin/preview.php --etsy snapshot.json --woo products.csv --out report/   # offline preview
```

Structure: `src/` is split into a pure core with no WordPress dependency (`Api`, `Etsy`, `Http`, `Match`, `Model`, `Oauth`, `Report`, `Snapshot`,
`Sync`, `Vault`, `Woo`, `Admin`) and the thin WordPress layer (`Wp`). A test fails if the core calls a WordPress function.
Etsy response shapes are written from the public documentation, not captured from the shop; see `docs/ETSY-INTEGRATION.md` section 16.
