# KCPrintWorks Custom Quotes (kcpw-quotes)

Custom quote requests from the storefront, reviewed and priced in WordPress, approved by the customer through a private expiring link, and paid
through WooCommerce (the official Stripe plugin) as an order for exactly the approved amount.

Full guide, staging checklist and the deployment steps: `docs/CUSTOM-QUOTES.md` in the repository. This file is the short version that ships in the plugin.

## What it does

1. **Request.** The storefront page `/custom-orders/` sends a request (name, email, project, description, size, quantity, colors, optional deadline, up to four
   pictures) to this plugin over a signed server-to-server call. It is saved as **New**, the customer gets a confirmation with a reference number
   (`KCQ-YYMM-XXXXXX`), and `contact@kcprintworks.com` (or `KCPW_QUOTES_NOTIFY_EMAIL`) is emailed.
2. **Quote.** In **Custom Quotes** (admin menu) you open the request, see the pictures, and fill in what you are offering, the item price, the shipping price
   and the date the offer stands until. **Email quote to customer** sends them a private link.
3. **Approve.** The customer opens the link on the storefront, sees the offer, gives a shipping address and approves. This creates **one** pending
   WooCommerce order (a fee line for the item, a shipping line) and sends them to WooCommerce's normal "Pay for order" page.
4. **Pay.** When WooCommerce says the order is paid *and* it is still exactly what the customer approved, the quote becomes **Paid** and you are emailed.
5. **Make it.** You set the quote to **In Production** and **Completed** yourself.

Statuses: New, Reviewing, Quoted, Approved, Paid, In Production, Completed, Declined, Expired, Cancelled. "Approved" and "Paid" are never set by hand:
they record what the customer and WooCommerce did.

## Install

1. Plugins > Add New > Upload Plugin > `kcpw-quotes.zip` > Install. **Do not activate yet** if this is the live site: try it on staging first.
2. Make sure `wp-config.php` has (the first is already there if checkout works):
   ```php
   define('KCPW_HANDOFF_SECRET', '<32 or more random characters, the same value as the storefront>');
   define('KCPW_STOREFRONT_URL', 'https://kcprintworks.com');   // the base of the customer's link
   ```
3. Activate. Open **Custom Quotes > Setup check**: every line should say Ready (a few say Check, with what to do).
4. Send yourself a test email from that page.

Optional settings in `wp-config.php` (all have safe defaults):

| Constant | Default | Meaning |
| --- | --- | --- |
| `KCPW_QUOTES_NOTIFY_EMAIL` | `contact@kcprintworks.com` | who is told about new requests and approvals |
| `KCPW_QUOTES_UPLOAD_DIR` | a protected folder inside uploads | an absolute folder **outside the web root** for pictures (best on Nginx) |
| `KCPW_QUOTES_TAXABLE` | `false` | `true` lets WooCommerce add sales tax on top of a quote; the customer is told |
| `KCPW_QUOTES_VALID_DAYS` | `14` | default length of an offer (1-90) |
| `KCPW_QUOTES_PAY_HOURS` | `72` | how long after approving the customer has to pay (1-720) |
| `KCPW_QUOTES_MAX_PER_HOUR` / `_MAX_ALL_PER_HOUR` | `6` / `100` | request limits per visitor and for the whole shop |
| `KCPW_QUOTES_DELETE_DATA_ON_UNINSTALL` | not set | `true` makes **deleting** the plugin also drop its tables |

## Safety, in one list

- Every storefront call is **signed** (HMAC, five-minute window, no replays). Unsigned requests are refused.
- A request **cannot carry a price, a status or an order**; unknown fields are refused. Prices exist only in the dashboard.
- The customer's link holds a 256-bit random token; only its hash is stored. A wrong token and a wrong reference give the same answer. Sending a
  revised quote makes a new link and the old one stops working. The link can approve **once**.
- The amounts on the order come from the stored quote, never from the browser. A fingerprint written on the order is checked again when payment arrives; an
  order that was edited (different total, extra items, another currency) is **not** marked paid: it is flagged for you.
- One quote makes one order: the order is created under a lease, after looking for an existing order for the quote, and a double click or retry returns the
  same payment address.
- Pictures: only real JPEG, PNG, WebP or GIF (checked by their bytes), re-drawn with GD so hidden content is dropped, stored under random names with no
  extension, and shown only to signed-in shop managers through a handler that sends them as images with `nosniff`.
- Customer data is private: nothing about a customer is in any URL, your notes are never emailed, and WordPress's Export/Erase personal data tools are supported.
- Normal checkout is **not touched**. The plugin adds only three WooCommerce hooks, and each returns immediately for an order that does not carry a quote id.

## Unverified (needs your staging check)

Developed and tested against stand-ins for WordPress and WooCommerce (the build environment cannot reach a real shop, Stripe, or email). The rules,
SQL and security checks are covered by automated tests; the behavior of **real** WooCommerce order-pay, the Stripe plugin, custom order tables (HPOS),
tax settings and your mail delivery must be confirmed with the staging checklist in `docs/CUSTOM-QUOTES.md`.

## Rolling back

Deactivate the plugin. Requests, quotes, pictures and WooCommerce orders stay in place and nothing else on the site changes. Reactivating picks up where it left off.
