# Custom quotes (owner guide)

Status: **built and tested against stand-ins only.** The storefront runs in the sandbox against a mock shop, and the WordPress plugin runs against stand-ins for
WordPress and WooCommerce plus a SQLite stand-in for the database. The sandbox cannot reach a real WordPress, WooCommerce, Stripe, your mail, or your VPS, so the
steps in sections 7 to 9 are what prove it on your real shop. **Nothing in this document has been done to your VPS, WordPress, Stripe or DNS**: every step
below that changes them is yours, and each is an approval point.

Decision record: [ADR-021](DECISIONS.md). Related: [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md) (paying is checkout), [DEPLOYMENT-VPS.md](DEPLOYMENT-VPS.md),
[PRODUCT-SEARCH.md](PRODUCT-SEARCH.md) (the "Can't find it?" link to this page).

```
Customer ─https─> kcprintworks.com/custom-orders/          the request form (name, email, project, description, size, quantity, colors, deadline, up to 4 pictures)
                     │  POST /api/quotes/                  checks it all, then ── signed server-to-server call ──>
                     ▼
              shop.kcprintworks.com  /wp-json/kcpw-quotes/v1/requests      kcpw-quotes plugin: saves it as NEW, stores the pictures privately,
                     │                                                      emails the customer a reference number and emails contact@kcprintworks.com
                     ▼
You ── WordPress admin ▸ Custom Quotes ──> review, price (item + shipping), set how long it stands, "Email quote to customer"
                     │                      status becomes QUOTED; the customer gets a private link with a 256-bit secret
                     ▼
Customer ─https─> kcprintworks.com/custom-orders/quote/?ref=KCQ-…&token=…      the offer, a shipping address, "I approve"
                     │  POST /api/quotes/approve/          the same checkout guards as the cart, then ── signed call ──> plugin /quote/approve
                     │                                      status becomes APPROVED; ONE pending WooCommerce order is made (a fee line + a shipping line)
                     ▼
Customer ─https─> shop.kcprintworks.com/checkout/order-pay/<id>/…        WooCommerce's normal "Pay for order" page + the official Stripe plugin
                     │  payment succeeds → WooCommerce marks the order Processing
                     ▼
              kcpw-quotes checks the order is still EXACTLY what was approved → status becomes PAID, you are emailed
You ── set IN PRODUCTION, then COMPLETED when you have made and shipped it
```

## 1. What it does, for the customer and for you

**The customer** asks on `/custom-orders/` (no payment, no account). They get an email with a reference number like `KCQ-2610-7K3MZP`. Later they get your quote by email
with a private link. On that page they see what you offered, the price, shipping, the total and the date it stands until, give a shipping address, tick "I approve this quote for $53.50"
and are taken to WooCommerce's payment page. They are never charged before that page, and the amount is the one you set.

**You** work in **WordPress admin ▸ Custom Quotes**: a list with status tabs and counts, search (name, email, reference, game), the request with its pictures, a form to set the
offer (what you are offering, details, item price, shipping, the day it stands until), the status box, a button to email the customer, private notes (never shown or emailed), a history of everything
that happened, and a link to the WooCommerce order once there is one. A red number on the menu shows how many requests are new. **Setup check** (top of the list) tells you in plain words what is
not ready.

Statuses: **New, Reviewing, Quoted, Approved, Paid, In Production, Completed, Declined, Expired, Cancelled.**

| Status | Meaning | Who/what sets it |
| --- | --- | --- |
| New | A request arrived | the request form |
| Reviewing | You are looking at it | you |
| Quoted | You emailed a quote; the link works until it expires | "Email quote to customer" (a revision resends and replaces the link) |
| Approved | The customer approved; a pending order waits for payment | the customer, through the link (never by hand) |
| Paid | WooCommerce says the order is paid **and** it still matches what was approved | WooCommerce's payment notice (never by hand) |
| In Production, Completed | You are making it / it is done | you |
| Declined, Cancelled | You will not do it / it was called off (an unpaid order is cancelled too) | you, or the order being cancelled in WooCommerce |
| Expired | The offer ran out, or the customer did not pay in time (the unpaid order is cancelled) | the hourly job, or the customer opening the link too late |

Moves you can make by hand (the status box only offers these): New → Reviewing, Declined, Cancelled; Reviewing → New, Declined, Cancelled; Quoted → Reviewing (takes the quote back), Declined, Cancelled;
Approved → Cancelled; Paid → In Production; In Production → Completed; Declined → Reviewing; Expired → Reviewing. To change a quote that was already sent, use **Send revised quote**: it makes a new
revision and a new link, and the old link stops working.

## 2. The three pieces and what each can do

| Piece | Where | Can | Cannot |
| --- | --- | --- | --- |
| Storefront (`/custom-orders/`, `/custom-orders/quote/`, `/api/quotes/`, `/api/quotes/approve/`) | the VPS container | show the form and the private page, check input, make photos smaller, call the plugin with a signed request | hold a price, a quote, a picture or customer data (nothing is stored there), call Stripe, write to WooCommerce |
| `kcpw-quotes` plugin | `shop.kcprintworks.com` | keep requests (its own tables), pictures (its own folder), make one pending order per approved quote, move a quote to Paid when its order is paid | change products, shipping zones, payment settings, the cart or the checkout form; it contains no payment code |
| WooCommerce + the official Stripe plugin | `shop.kcprintworks.com` | take the payment on the normal "Pay for order" page | nothing new: they do not know what a quote is except through the order's `_kcpw_quote_*` fields |

## 3. Settings

### Storefront (the VPS `.env`; run time, no rebuild; every existing setting is unchanged)

| Setting | Default | Meaning |
| --- | --- | --- |
| `QUOTES_ENABLED` | `false` | `true` turns the **request form** on. Needs the shop address and `KCPW_HANDOFF_SECRET` already used by checkout (it reuses them). Off: `/custom-orders/` shows your email address instead of the form. |
| `CHECKOUT_ENABLED` | `false` (existing) | **Also required for customers to approve and pay a quote**: paying is checkout. Quotes alone never turn payments on. On a production image the stricter rules in [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md) apply, and on every approval the shop is asked who it is (staging builds only proceed while Stripe reports **test mode**). |
| `QUOTES_TIMEZONE` | `America/Detroit` | decides "today" for deadlines |
| `QUOTES_RATE_LIMIT`, `QUOTES_RATE_LIMIT_ALL` | `4`, `60` | requests per visitor / for everyone, per hour |
| `QUOTES_APPROVE_RATE_LIMIT`, `QUOTES_APPROVE_RATE_LIMIT_ALL` | `20`, `200` | approval attempts per visitor / for everyone, per hour |
| `SEARCH_SYNONYMS` | built-in list | product search words; see [PRODUCT-SEARCH.md](PRODUCT-SEARCH.md) |

`/api/quotes-status/` shows what is on and what is missing (names only, no secret, no address). Example: `{"environment":"staging","requests":{"enabled":true},"payments":{"enabled":true,"allowed":true}}`.

### WordPress (`wp-config.php`; you edit this file, I never do)

```php
define('KCPW_HANDOFF_SECRET', '<32+ random characters>');   // the SAME value as the storefront (checkout already needs it)
define('KCPW_STOREFRONT_URL', 'https://kcprintworks.com');  // the base of the customer's quote link
// Optional:
define('KCPW_QUOTES_NOTIFY_EMAIL', 'contact@kcprintworks.com');   // default
define('KCPW_QUOTES_UPLOAD_DIR', '/var/www/private/kcpw-quotes'); // best: outside the web root
define('KCPW_QUOTES_TAXABLE', false);        // true = WooCommerce adds sales tax on top of the quoted amounts
define('KCPW_QUOTES_VALID_DAYS', 14);        // default length of an offer (1 to 90)
define('KCPW_QUOTES_PAY_HOURS', 72);         // how long after approving the customer has to pay (1 to 720)
define('KCPW_QUOTES_MAX_PER_HOUR', 6);       // requests per visitor per hour; KCPW_QUOTES_MAX_ALL_PER_HOUR (100) for everyone
```

**One shop, two storefronts.** A shop has one `KCPW_STOREFRONT_URL`, and a quote's emailed link starts with it. While you test on staging, set it to the staging address
(`https://dev.kcprintworks.com`) so the link opens staging; set it to `https://kcprintworks.com` when production goes live (checkout needs the same change:
[CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md) section 4.2). A quote requested on one storefront and linked to the other still works (same shop, same secret), but the link opens whichever
site `KCPW_STOREFRONT_URL` names.

**Tax.** By default the quoted total is the total: no tax is added, and the quote email says so only by showing the total. If you must charge sales tax, either include it in the item price or set
`KCPW_QUOTES_TAXABLE` to `true`: then WooCommerce adds tax by its own rules on the "Pay for order" page, the quote page and email say "plus sales tax where it applies", and the payment check allows exactly
the tax WooCommerce added and nothing else. **How WooCommerce calculates tax for such an order (it uses the billing/shipping address the customer typed) is unverified: check one test order.**

## 4. Security, by threat (each line has a test)

| Threat | What stops it | Where it is tested |
| --- | --- | --- |
| A customer changes the price | A request, an approval and a hand-off carry **no price field**; unknown fields are refused (400, "form_expired"). Amounts are read from the stored quote when the order is made. | `QuoteVectorsTest`, `IntakeTest`, `CustomerTest` (price fields), `quote-approve.test.ts`, e2e |
| An order is edited after approval (different total, extra item, other currency, a clone for the same quote) | A keyed fingerprint (quote, revision, both amounts, currency, tax treatment, email) is written on the order. WooCommerce is told the order **needs no payment** (so no payment form is shown and nothing is charged) while its lines differ from the approved quote; and if a payment still gets through (edited between opening the form and paying), the check runs again: a mismatch is **not** marked paid, the quote is flagged, the order gets a note and you get an email. | `OrderHooksTest`, `PaymentsTest` |
| A link is reused or guessed | 256-bit random token, only its SHA-256 stored, compared in constant time; wrong reference and wrong token give the same answer; revising/withdrawing/cancelling makes the link dead; approving works once (compare-and-swap on the revision); expiry is checked on every use. | `CustomerTest`, `AdminTest` |
| A double click, a second tab, a retry or a crash makes two orders | The quote moves Quoted → Approved in one atomic update; the order is made under a short lease after looking for an existing order carrying the quote id; a second request gets the same payment address. | `CustomerTest` (`double click`, `lease`, `crash recovery`) |
| Someone pays an old, cancelled or expired quote's order | While the quote is not Approved, in time, unchanged and pointing at that order, the order **does not need payment** (WooCommerce refuses to show a pay form), and WooCommerce's own "cancel unpaid orders" job leaves quote orders to the quote's payment window. | `OrderHooksTest` |
| Money arrives for a quote that was cancelled meanwhile | Never hidden: the quote keeps its status, is flagged, you are emailed, and the history says what happened. | `PaymentsTest` |
| Strangers use the plugin's endpoints | HMAC-signed requests (timestamp window of 5 minutes, one-time nonce, signature bound to method, route and body); unsigned or replayed requests get 401. Same scheme and secret as checkout. | `SigningTest`-style cases in `RestApiTest` |
| Spam and floods | Hidden field, signed form token (at least 5 seconds old, at most 4 hours), per-visitor and overall limits on the storefront **and** again in the plugin, repeat-request detection (same words in ten minutes = same request), body-size limit. The visitor's address never leaves the storefront (a keyed hash does). | `quote-submit.test.ts`, `IntakeTest` |
| Harmful uploads | Only JPEG, PNG, WebP, GIF decided by their **bytes** (name and claimed type are not trusted), at most 4, 2.5 MB each, 5 MB total, 12 megapixels and 8000 px a side (checked from the header before decoding), re-drawn with GD so appended code and metadata are dropped (a GIF becomes a PNG), stored under a random 40-character name **with no extension** in a folder web servers are told to deny, and shown only through a signed-in, nonce-checked dashboard handler that sends `nosniff` and a sandboxing policy. | `ImagePolicyTest`, `FileStoreTest`, `AdminScreensTest`, `quote-submit.test.ts` |
| Script or markup in a request, email header injection | Every value is escaped where shown; emails are plain text with single-line subjects, names and addresses; control and invisible characters are refused. | `AdminScreensTest` (XSS), `IntakeTest`, `AdminTest` |
| A private link leaks through the address bar | The page is `noindex`, `Referrer-Policy: no-referrer` (`<meta name="referrer">`), never cached, and the token is not logged by the app. **Web servers and proxies in front of it may log the full address, and browser history keeps it**; that is why the token expires with the quote, and why revising always makes a new one. | e2e (`private page`) |
| Customer data exposed | Nothing about a customer is in a URL or an email except to them; the customer page shows the offer and their first name only; notes are private; WordPress's **Export/Erase personal data** tools work with quotes (live quotes are not erased). | `CustomerTest`, `PrivacyTest` |
| Normal checkout changes | Three WooCommerce hooks, each returning at once for an order without a quote id; nothing hooks the cart, the checkout form, gateways, shipping or products. | `OrderHooksTest`, `scripts/quotes/package.test.mjs` |
| A staging build reaches live Stripe | Approving (and showing "Continue to payment") asks the shop who it is every time and refuses unless it reports Stripe **test mode** on non-production builds. | e2e (`payment is only offered while …`), `shop-guard.test.ts` |
| The shop hands back a strange payment address | Accepted only if it is the shop's own origin and WooCommerce's order-pay page; otherwise the customer is told to try again, nothing is followed. | `quote-approve.test.ts` |

## 5. What the plugin stores

Four tables with the site's prefix: `kcpw_quotes` (the request, the offer, times, the token's hash, the order id, the fingerprint), `kcpw_quote_files`, `kcpw_quote_notes`, `kcpw_quote_events`.
Pictures live in the pictures folder (section 3). **Orders** are ordinary WooCommerce orders (works with custom order tables / HPOS on or off) carrying `_kcpw_quote_id`, `_kcpw_quote_ref`,
`_kcpw_quote_fp` (and `_kcpw_quote_closed` when the plugin itself cancelled it). The order has one fee line "Custom order KCQ-…: <title>" (the item) and one shipping line (the shipping you quoted),
billing and shipping addresses from the customer's approval, and no product. WooCommerce's usual emails (receipt to the customer, "new order" to you) go out as for any order; the plugin adds one
email to you when a quote is paid and one when it is approved.

## 6. Day-to-day use

1. A request arrives (email + the red number on the menu). Open it, look at the pictures. Use **Email the customer** if you need to ask something. Set the status to Reviewing if you want to mark it.
2. Fill in **Your quote** (what you are offering, details, item price, shipping, until when) and press **Email quote to customer**. It becomes Quoted. If email fails, the quote is kept, flagged, and you can press the button again.
3. The customer approves and pays. You are emailed twice (approved, then paid). Open the quote: the history shows each step and the order number.
4. Make it, then set **In Production** and **Completed**.
5. To change a sent quote, press **Send revised quote** (a new link is emailed, the old one stops). If the customer had already approved but not paid, the unpaid order is cancelled for you. If they have paid, it cannot be revised (refund or cancel in WooCommerce first).
6. To walk away: **Declined** or **Cancelled** (an unpaid order is cancelled too; a paid order is never touched: refund it in WooCommerce first).
7. **Needs attention** (red text, a filter tab, an email) means something wants a person: a payment that did not match, an email that failed, a picture that could not be saved, a refund. Look, act, press "Mark as looked at".

Refunds are done in WooCommerce/Stripe as for any order. The quote keeps its status and is flagged so you remember to update it.

## 7. Install and try it on STAGING first (your approval for each step)

I have not done any of this. Staging uses the same WooCommerce site as production, so keep Stripe in **test mode** throughout.

1. **Plugin package.** Download `kcpw-quotes.zip` from the GitHub Actions run of this branch (artifact `kcpw-quotes-plugin`), or build it: `npm run build:quotes-plugin`.
2. **wp-config.php** on the shop: confirm `KCPW_HANDOFF_SECRET` (already there for checkout), add `KCPW_STOREFRONT_URL` = `https://dev.kcprintworks.com` for the test (section 3), and optionally the others.
3. **Install and activate:** Plugins ▸ Add New ▸ Upload Plugin ▸ the zip ▸ Install ▸ Activate. This creates four tables and schedules an hourly job; it changes nothing else.
4. **Custom Quotes ▸ Setup check:** every line Ready or an explained Check. Press **Send a test email** and confirm it arrives. Fix anything marked Fix first.
5. **Staging `.env`** (`/opt/kcprintworks-nextjs/.env`): `QUOTES_ENABLED=true`. Keep `CHECKOUT_ENABLED=true` only if checkout already works on staging (it is needed for the approval step). Then
   `cd /opt/kcprintworks-nextjs && ./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"` (recreates the container with the new settings, same image) and
   `curl -s https://dev.kcprintworks.com/api/quotes-status/`. Expect `"requests":{"enabled":true}` and, with checkout on, `"payments":{"enabled":true,"allowed":true}`.

### Staging checklist (tick each; send me anything that fails, never secrets)

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Open `https://dev.kcprintworks.com/`; look under the two hero buttons | "Request a Custom Quote" on its own row, left-aligned with Shop Now |
| 2 | Click the search icon next to Cart, type a word; press Enter | live results, then the search page; a search with no match offers "Request a Custom Quote" with your words filled in |
| 3 | Open `/custom-orders/`, press Send with the form empty | an error list that takes focus |
| 4 | Fill it in with a real photo from your phone (several MB) and send | a reference number; the photo was made smaller before sending |
| 5 | Your inbox | the confirmation to the customer address and the notification to `contact@kcprintworks.com` |
| 6 | WordPress ▸ Custom Quotes | the request is **New**; its picture opens; you see the history |
| 7 | Set item $4.50 (any small amount ≥ $0.50), shipping $1.00, a date; **Email quote to customer** | status **Quoted**; the customer email has the amounts, the date and a link starting `https://dev.kcprintworks.com/custom-orders/quote/` |
| 8 | Open the link in a private window | the offer and total; an address form; nothing about the customer except the first name |
| 9 | Press **Send revised quote** with a different price; open the OLD link | "This quote link is not valid"; the new link shows the new price |
| 10 | On the new link: fill the address, tick, press **Approve** | you land on `shop.kcprintworks.com/checkout/order-pay/…` showing exactly the quoted total and your address; the quote is **Approved**, with a pending order #N |
| 11 | Press the browser Back, then approve again | the same payment page; **no second order** in WooCommerce ▸ Orders |
| 12 | Pay with a Stripe **test** card (4242 4242 4242 4242) | WooCommerce's order-received page; the order is Processing; the quote is **Paid** within a minute; you got an email |
| 13 | Open the quote link again | "Paid. Thank you!"; no approve or pay buttons |
| 14 | Set the quote to In Production, then Completed | both accepted |
| 15 | Make a second quote; approve it; **do not pay**; in WooCommerce edit the pending order (change the fee amount), then open its payment address | WooCommerce will not take payment (nothing to pay); the quote link says payment is not available; **Send revised quote** makes a fresh order and link |
| 16 | Make a third quote, approve it, then press **Cancel** on the quote | its pending order becomes Cancelled; opening its pay address shows nothing to pay |
| 17 | Make a fourth quote with a one-day offer (set the date to today); wait until after midnight in the shop's time zone and open the link (or wait for the hourly job) | "This quote has expired"; status Expired |
| 18 | Place an ordinary order for a normal product the usual way | works exactly as before; the order has no `_kcpw_quote_*` fields |
| 19 | Tools ▸ Export Personal Data for a test address | the quote data is listed; Erase leaves live quotes and erases finished ones |
| 20 | Turn Stripe to live mode on a **copy** only if you want to see the staging guard (never on the real shop for this test) | staging refuses to approve: "Online approval is not open yet" |

What I could not check and you are proving: WooCommerce's real "Pay for order" page for a guest with this order shape, the Stripe plugin on that page (including its webhooks), custom-order-table (HPOS) behavior,
how your tax settings treat the order, your mail delivery, your server's `post_max_size`, and that nothing in front of the shop (firewall, security plugin) blocks the VPS calling `/wp-json/kcpw-quotes/v1/…`.

## 8. Deploy to production (your approval; I have not done this)

Prerequisites: staging checklist passed; checkout works on production (or is being turned on with it: [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md)); the plugin is installed on the shop.

**A. The image.** A production image is built by the GitHub Actions workflow **Publish Docker image** (Run workflow ▸ `site_env` = production). Its summary lists the tag, ending `-production`. I only build and publish
images; I never deploy.

**B. On the shop (you):** set `KCPW_STOREFRONT_URL` to `https://kcprintworks.com` in `wp-config.php`; the plugin is already active from staging (one plugin serves both storefronts). Setup check should show Ready.

**C. On the VPS over SSH.** Replace `sha-XXXXXXX-production` with the tag from the run summary. Nothing outside the production project is touched (`deploy.sh` only runs `docker compose` for its own directory).

```bash
ssh <you>@<vps>
cd /opt/kcprintworks-production
cp .env ".env.backup-$(date +%Y%m%d-%H%M)"            # keep your current settings
docker pull ghcr.io/cyberbandit1998/kcprintworks-nextjs:sha-XXXXXXX-production
# 1. Update the image first, with quotes still OFF (the new settings are additive and default to off):
./deploy.sh sha-XXXXXXX-production
./deploy.sh --status
curl -s https://kcprintworks.com/api/quotes-status/    # requests.enabled false, payments.enabled false
# 2. When you are ready to take requests, add this one line to .env (use nano; never paste secrets anywhere else):
#      QUOTES_ENABLED=true
#    (customers can approve and pay only if CHECKOUT_ENABLED=true is already set and passes its checks)
./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"
curl -s https://kcprintworks.com/api/quotes-status/    # requests.enabled true; payments.enabled/allowed as expected
```

**D. Roll back, any time, in seconds (no rebuild; everything existing keeps working):**

```bash
cd /opt/kcprintworks-production
# Turn the feature off but keep the new image:
sed -i 's/^QUOTES_ENABLED=.*/QUOTES_ENABLED=false/' .env && ./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"
# Or go back to the previous image entirely:
./deploy.sh --rollback
./deploy.sh --status
# Or restore the settings you backed up:
cp .env.backup-YYYYMMDD-HHMM .env && ./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"
```

Staging is the same with `cd /opt/kcprintworks-nextjs` and a staging tag (`sha-XXXXXXX`, no suffix). On the shop, **deactivating the plugin** is the full rollback of its part: requests, quotes, pictures and WooCommerce orders stay where they are,
nothing else on the site changes, and reactivating picks up where it left off. Customers with an emailed link then see "Quotes are not available here yet" (the storefront cannot reach the plugin) and can still email you.
Deleting the plugin removes nothing either, unless you first add `define('KCPW_QUOTES_DELETE_DATA_ON_UNINSTALL', true);` to `wp-config.php` (then the four tables are dropped; the pictures folder is never deleted for you).

## 9. After deploying: the test checklist

1. `curl -sI https://kcprintworks.com/ | head -5` → 200; `curl -s https://kcprintworks.com/api/health/` → `{"status":"ok"…}`.
2. `curl -s https://kcprintworks.com/api/quotes-status/` shows what you expect for this stage.
3. The home page: hero image unchanged, Shop Now and Our Story side by side, the quote button on the row below; the header search icon next to Cart on desktop and on your phone; Cart, Shop, product pages, checkout work as before (one normal test order).
4. `/search/?q=<a game you sell>` finds it; a made-up word offers the quote link with the word filled in.
5. `/custom-orders/`: send one real request from your phone with a photo; both emails arrive; it shows in Custom Quotes.
6. Send yourself the quote; open the link; **approve; pay with a Stripe test card only while Stripe is in test mode** (on production that means before you switch Stripe live); confirm Paid.
7. Switch Stripe live (your decision) and do one real low-value quote end to end, then refund it in Stripe.
8. `docker logs --tail 100 kcprintworks-production` has no `[quotes]` lines beyond the ones you caused.

## 10. Privacy and keeping data

Requests contain names, emails, descriptions and pictures; approvals add an address and phone. They stay in your WordPress database and pictures folder, on your server. Nothing is sent to a third party by this
feature except the emails you send through your site's mail. Use Tools ▸ Erase Personal Data to remove a customer's request details (reference, status, dates and amounts stay as records). The plugin never deletes
old quotes by itself; tell me if you want a retention rule (for example, erase finished requests after two years).

## 11. Troubleshooting

| You see | Likely cause and fix |
| --- | --- |
| `/custom-orders/` shows "The request form is not open yet" | `QUOTES_ENABLED` is not `true`, or the shop address / `KCPW_HANDOFF_SECRET` is missing: `/api/quotes-status/` names it. |
| The form says "We could not send your request right now" | `docker logs` shows `[quotes] request not saved: …`: 401 = the two secrets differ; 404 = the plugin is not active; 503 = `KCPW_HANDOFF_SECRET` missing in `wp-config.php`; a timeout = a firewall between the VPS and the shop. |
| A quote email does not arrive | Setup check ▸ Send a test email. Use an SMTP plugin on the shop if the host's mail is unreliable. The quote is kept and flagged; send it again. |
| Customer's link says "not valid" | They are using an older email (each revision makes a new link), you took the quote back or cancelled it, or the link was cut when copied. Send a revised quote. |
| "Online approval is not open yet" | Payments are off (`CHECKOUT_ENABLED`), the shop is unreachable, or this is a staging build and the shop is in live Stripe mode. `/api/quotes-status/` says which. The customer can still email you. |
| A paid order did not turn the quote to Paid | Look at the quote's history and "Needs attention": the order no longer matched the approved quote (edited, extra items, another currency), or the order is not the quote's order. The order has a note saying why. |
| Pictures do not show in the dashboard | Setup check ▸ pictures folder. On Nginx, `.htaccess` is ignored: set `KCPW_QUOTES_UPLOAD_DIR` to a folder outside the web root. |

## 12. Not done / limits (be honest about this)

- Real WordPress/WooCommerce/Stripe/mail: not run by me. Section 7 is the proof. The PHP behind `WcOrderGateway` and the hooks is tested against stand-ins that follow WooCommerce's documented behavior, not the real thing.
- Currencies with other than two decimals are refused (a clear message in the dashboard). Shipping is the amount you quote, not WooCommerce's shipping zones.
- Unpaid orders for quotes are cancelled by the plugin when a quote is revised, cancelled or runs out; if the customer is in the middle of paying at that moment and Stripe still completes the payment, the payment notice reaches a cancelled order: the quote is flagged for you and you refund in Stripe. This race is rare and was reasoned about, not reproduced.
- The hourly expiry job uses WordPress's scheduler (WP-Cron), which runs when the site gets visits. A customer opening an expired link also expires it on the spot.
- There is no customer account area, no reminder emails before a quote expires, and no automatic follow-up. Those are easy additions if you want them.
