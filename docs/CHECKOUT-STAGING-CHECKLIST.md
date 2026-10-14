# Checkout: staging setup and test checklist (owner runbook)

Status: **ready to follow; nothing here has been run against a real WordPress, WooCommerce, or Stripe.** The code was tested with stand-ins
(`wordpress/kcpw-core/tests`, `apps/storefront/tests`). This checklist is how the real thing gets proven. Do it on a **staging copy** of
the shop, with Stripe in **test mode**. Doing any of it on the live store changes the live store and needs your approval first.

What gets installed and what it does:

| Piece | Where | Does |
|---|---|---|
| `kcpw-core` plugin (this repo, `wordpress/kcpw-core`) | staging WordPress | Receives the storefront's signed cart, validates it against WooCommerce, builds the WooCommerce cart, saves personalization on the order item. **Contains no payment code, never edits products.** |
| Official **WooCommerce Stripe Payment Gateway** plugin (from WooCommerce / Stripe) | staging WordPress | Takes the payment. Entirely its own settings, in **test mode** |
| Storefront container | your VPS | Shows products, holds the cart, hands it over. Checkout is **off** until you switch it on in its `.env` |

## 1. Install `kcpw-core` on the staging WordPress

1. Get the zip: GitHub > Actions > the latest **CI** run on branch `claude/hopeful-hamilton-lq8pw6` > Artifacts > **kcpw-core-plugin** (GitHub wraps it in
   another zip; unpack once to get `kcpw-core.zip`). Or on a computer with Node 22: `npm run build:core-plugin` writes `dist/kcpw-core.zip`.
2. Staging WordPress admin > Plugins > Add New > Upload Plugin > `kcpw-core.zip` > Install > **Activate**. Needs WooCommerce active, PHP 8.1+, the `mbstring` extension.
3. Add to the staging `wp-config.php`, above the line "That's all, stop editing":

```php
define('KCPW_HANDOFF_SECRET', 'PASTE-64-RANDOM-CHARACTERS');          // generate with:  openssl rand -hex 32
define('KCPW_STOREFRONT_URL', 'https://YOUR-STAGING-STOREFRONT');      // where the storefront lives (no trailing slash needed)
```

   Keep the secret out of chats and tickets. The storefront needs the same value in step 5.
4. WooCommerce > **Checkout link**: every row should say **Ready** (the Stripe rows turn green after step 2). Fix any **Fix** row using its "What to do" text.
5. Make sure your page-cache plugin does **not** cache the home page with a `?kcpw_handoff=` address (most skip pages with unknown query strings; check yours).

## 2. Stripe, test mode only

1. Install and activate **WooCommerce Stripe Payment Gateway** (Plugins > Add New).
2. In its settings (WooCommerce > Settings > Payments > Stripe) switch on **Test mode** and enter your **test** publishable and secret keys from the Stripe dashboard
   (the dashboard's "test mode" toggle on). Type them into WordPress yourself; never paste keys into a chat.
3. Follow the plugin's own screen for the **webhook** (it shows the address to add in the Stripe dashboard and the signing secret to enter). Webhooks are what mark an
   order paid; the page the shopper returns to is never trusted.
4. WooCommerce > Checkout link should now show "Stripe is in TEST mode". If it says LIVE mode, switch the plugin back to test mode before doing anything else.

## 3. Define personalization on a product

Products > edit a product > **Product data** box > **Personalization** tab. Add a row per field: a label ("Name"), a type, whether it is required, the length limits,
choices (one per line, `Navy` or `Hot Pink | +0.50`), and an extra charge if any (`+2.50` or `+10%`). Update the product. Rows left empty are ignored;
**Advanced** shows the same setup as JSON you can copy to another product. Bag tag suggestion: Tag color (choice), Text color (choice), Cable color (choice, your list),
Name (short text, required, 1 to 24). Until a product has a setup here, the shop will refuse to take any personalization for it (the storefront shows the fields it
*suggests* from the title; the shop only accepts what is saved here).

> A synchronization service might overwrite or delete product meta when it updates a product. After the next sync, open one personalized product and confirm the
> setup is still there. If it is not, tell me and keep the JSON copy of each setup.

## 4. Switch the storefront's checkout on (staging only)

On the VPS, in `/opt/kcprintworks-nextjs/.env` (edit with a text editor; `chmod 600 .env`):

```
CHECKOUT_ENABLED=true
KCPW_API_URL=https://YOUR-STAGING-WORDPRESS      # optional: when empty, KCPW_SHOP_URL and then WC_BASE_URL are used (the shop is the WooCommerce site)
KCPW_HANDOFF_SECRET=<the same value as in wp-config.php>
```

Then `./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"` (same image, new environment). Verify the link:

```bash
curl -s https://YOUR-STAGING-STOREFRONT/api/checkout-status/
# expect: {"enabled":true,"environment":"staging","allowed":true,"returnAddress":"not_checked","shop":{"reachable":true,"plugin":"0.2.1", ... "stripeActive":true,"stripeTestMode":true}}
```

`allowed` is what the next shopper would get. `"allowed":false` names why: `unreachable` (the line below), or `live_mode_blocked`: a staging build only hands carts to a shop
that reports Stripe in **test** mode, so this appears the moment the shop is switched to live (by design: staging must never reach real payments).
The shop block's `reachable:false` names the reason ("did not accept the signature" = the two secrets differ; "route not found" = the plugin is not active).
A production image is a different image with its own rules: [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md).

### If the cart still says "Online checkout is not open on this site yet"

The button is disabled whenever the container finds checkout switched off or incomplete. The container tells you which, and it never needs a rebuild: the setting is read on every request.

```bash
curl -s https://YOUR-STAGING-STOREFRONT/api/checkout-status/
# {"enabled":false,"reason":"not fully configured","missing":["KCPW_HANDOFF_SECRET (32 or more characters)"]}   names what is missing, never a value
docker logs kcprintworks-nextjs 2>&1 | grep '\[checkout\]'                      # the same reason, in the server log

# What the container actually received (the secret is shown only as a length):
docker exec kcprintworks-nextjs sh -c 'for v in CHECKOUT_ENABLED KCPW_API_URL KCPW_SHOP_URL WC_BASE_URL SITE_ENV; do printf "%s=%s\n" "$v" "$(printenv $v)"; done; printf "KCPW_HANDOFF_SECRET length=%s\n" "$(printenv KCPW_HANDOFF_SECRET | tr -d "\n" | wc -c)"'
```

- A name that is in `.env` but **empty or absent in the container** means the compose file is older than the image: refresh it from the image ([DEPLOYMENT-VPS.md](DEPLOYMENT-VPS.md), "update") and run `./deploy.sh` again. Compose passes only the names it lists.
- `SITE_ENV=production` in the image disables checkout on purpose; use the staging image.
- `"missing":["KCPW_HANDOFF_SECRET ..."]`: the container has no secret, or fewer than 32 characters. It must equal `KCPW_HANDOFF_SECRET` in the shop's `wp-config.php`.
- `"enabled":true` with `"reachable":false` is a different problem (secret mismatch, plugin inactive): the answer names it.

## 5. Test it

Use Stripe's test cards: any future expiry, any 3-digit CVC, any postcode. **Never type a real card number.**

| # | Do | Expect |
|---|---|---|
| A | Add a plain product, open the cart, press **Checkout** | You land on the WooCommerce checkout with the same item and quantity. Shipping and tax appear once the address is entered |
| B | Pay with `4242 4242 4242 4242` | Order received; in WooCommerce > Orders the order is **Processing**; the Stripe dashboard (test) shows the payment |
| C | Personalized product: fill the name, add, checkout, pay | The name shows in the storefront cart, on the WooCommerce checkout, in the order's item (admin), and in the order e-mail, **exactly as typed** |
| D | Add the same personalized product twice with **different** names | Two separate lines, each with its own name |
| E | A product with "Any" variations (bag tag): pick both colors | The order line shows both colors; the variation id is the product's own |
| F | `4000 0025 0000 3155` (asks for authentication) | The authentication step appears; completing it pays the order, failing it leaves the order unpaid |
| G | `4000 0000 0000 9995` and `4000 0000 0000 0002` (declined) | A clear decline message; the order is not Processing; a retry with `4242...` works |
| H | Press Checkout, then press your browser's Back and Checkout again | One cart at checkout, not two; one charge at most |
| I | Open the checkout link twice, or in a second browser | The second use sends you back to the storefront cart with "link expired" |
| J | Put an item in the cart, then change its price in WooCommerce, then press Checkout | "Something in your cart changed ...": nothing is charged at the old price; a reload shows the new price |
| K | Set an item out of stock in WooCommerce, then press Checkout | The cart says it cannot be ordered; no checkout starts |
| L | In the Stripe dashboard (test) resend a `payment_intent.succeeded` event | The order does not change twice (no second e-mail, no stock change) |
| M | After paying, open WooCommerce > Orders > the order > the item | Visible lines for each choice; a hidden `_kcpw_personalization` record exists |
| N | Free-shipping bar: carts a few cents under, exactly at, and above your minimum, then a coupon that drops one below ([FREE-SHIPPING.md](FREE-SHIPPING.md)) | The cart's message agrees with whether WooCommerce shows free shipping; any mismatch means the minimum in `.env` or one of the doc's assumptions is off |

Not testable here and worth a look: your real shipping zones and tax settings (WooCommerce computes both), the look of the checkout page (it is WooCommerce's own),
order e-mails, and what your Etsy sync service does with orders (we do not touch it).

## 6. What to send back

For each lettered row: pass, fail, or "different from expected" with a screenshot (hide any keys) and, if something failed, the text of the notice. Also the output of
`/api/checkout-status/` and the **Checkout link** page. That tells me what to fix before any live step.

## 7. Undo

- Storefront: set `CHECKOUT_ENABLED=false` in `.env` and run the same `deploy.sh` line. The button goes back to the disabled state.
- WordPress: deactivate and delete **KCPrintWorks Core**. It removes only its handoff table; the personalization setups on products and the choices saved on
  past orders are kept on purpose so orders stay readable.
- Stripe: leave it in test mode; remove the keys in the plugin settings.
