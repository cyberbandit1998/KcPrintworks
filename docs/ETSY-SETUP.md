# Connecting the Etsy Seller App (owner runbook)

Status: **ready for you to follow on a staging copy of WordPress.** I could not open Etsy's pages from my environment, so the Etsy-side steps below are described from the documentation excerpts
available to me; follow Etsy's current form where it differs and tell me what it says. Nothing in this runbook changes the live store, creates or edits a product, or writes to Etsy.

Why staging: installing a plugin, adding a `wp-config.php` constant, and storing an Etsy token are all changes to the WordPress site they happen on. You asked that the live site stay unchanged until you
approve the first synchronization, so do this on a staging copy (your host's staging feature, or a clone). If you have no staging site yet, tell me and we will make one first
([MIGRATION-SHOP-DOMAIN.md](MIGRATION-SHOP-DOMAIN.md) describes cloning).

## 1. Register a Seller App on Etsy (you; only you can)

1. Sign in to Etsy as the owner of `kcprintworks.etsy.com` and open the developer portal (<https://www.etsy.com/developers/your-apps>). Choose to create a new app and pick the **Seller App** type (Etsy's help
   article "How to Register a Seller App with Etsy's API"). A Seller App works only with your own shop, which is exactly this use. If Etsy says you already have a registered app, tell me before doing anything else.
2. Name and describe it honestly, for example: _KCPrintWorks product sync: reads my own shop's listings into my own website (read-only)._ State that it is used only by the shop owner.
3. **Callback (redirect) URL:** use the exact address shown on the plugin's **Connection** screen in step 3 below. It is an https address on your staging WordPress; Etsy compares it character for character, so copy it,
   do not retype it. (You can add the production address later; do not register it now.)
4. When Etsy approves the app, copy the **API key (keystring)**. If the portal also shows a **shared secret**, keep it for step 3; whether Etsy requires it in requests is one of the things *Test connection* checks.
5. Never paste the key or secret into a chat or a ticket, and never into the repository.

## 2. Install the plugin on staging

1. Get the zip: GitHub > Actions > the latest **CI** run on branch `claude/hopeful-hamilton-lq8pw6` > Artifacts > **kcpw-etsy-plugin** (GitHub wraps it in another zip; unpack once to get `kcpw-etsy.zip`). Or on a machine with Node 22: `npm run build:etsy-plugin` writes `dist/kcpw-etsy.zip`.
2. Staging WordPress admin > Plugins > Add New > Upload Plugin > choose `kcpw-etsy.zip` > Install > **Activate**. Requirements: WooCommerce active, PHP 8.1 or newer, PHP `sodium` extension (standard in modern PHP).
3. Add to the staging site's `wp-config.php`, above the line that says "That's all, stop editing":

```php
define('KCPW_ETSY_API_KEY', 'PASTE-THE-KEYSTRING');
define('KCPW_ETSY_ENC_KEY', 'PASTE-32-OR-MORE-RANDOM-CHARACTERS');   // e.g. run: openssl rand -hex 32
// Only if Etsy requires the shared secret in the key header (the Test connection screen will say so):
// define('KCPW_ETSY_SHARED_SECRET', 'PASTE-THE-SHARED-SECRET');
// define('KCPW_ETSY_SEND_SECRET', true);
```

   The first two are mandatory. The encryption key protects the stored Etsy tokens; back it up with the site, because losing it means reconnecting.

## 3. Connect and test

1. WooCommerce > **Etsy sync** > **Connection**. Copy the **Redirect address** into the Etsy app's callback field (step 1.3) and save it on Etsy.
2. Choose **Connect with Etsy**, review what Etsy asks for (only **read** permissions: `shops_r` and `listings_r`) and approve. You return to the Connection screen showing the shop and the permissions granted.
3. Choose **Test connection**. It makes a few read-only calls and compares Etsy's real answers with the shapes the plugin expects. Every `warn` or `fail` row names the field or call that differed.
   **Send me those rows** (they contain no secrets); they are the first real evidence about Etsy's API and decide what I must adjust before anything else.

## 4. Download and review (still read-only)

1. **Import preview** > **Download Etsy listings now**. It runs in small steps, respects Etsy's rate limit, shows progress, and can be repeated.
2. Review the matching report: which listings are already linked, which products are proposed, which are **ambiguous** (for example the duplicate imports in your WooCommerce catalog), and which listings have no product.
   For each ambiguous listing pick the product to keep, **ignore**, or **create new**, then **Save decisions**. (Or download the CSV, decide in a spreadsheet, and send it back.)
   Saving decisions changes nothing in WooCommerce.
3. **Dry-run plan** shows, field by field, what a synchronization *would* change under the rules in [ETSY-INTEGRATION.md](ETSY-INTEGRATION.md) section 7. It is a description; the plugin cannot apply it.

## 5. What happens next (and needs your approval)

The first synchronization (applying approved fields to WooCommerce, first on staging, with a change log and rollback) is **not built yet** and will not be started until you have reviewed the matches and the dry-run and said so.

## Undo

Deactivate and delete the plugin (tokens, settings, and scheduled events are removed; add `define('KCPW_ETSY_KEEP_DATA', true);` first to keep the downloaded data and your decisions). In Etsy's developer portal you can also revoke the app's access to the shop at any time.
