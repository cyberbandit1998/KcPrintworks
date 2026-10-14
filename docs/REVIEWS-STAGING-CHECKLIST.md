# Writing a review: proving it on a real WordPress (staging)

The tests for review submission use stand-ins for WordPress and WooCommerce (`wordpress/kcpw-core/tests`, `apps/storefront/tests`). They prove the
rules and what the code asks of WordPress. They cannot prove that the real WordPress and WooCommerce answer that way. This checklist does.

**The rule for this checklist: a test review is never approved.** Your WooCommerce is the live one. An approved review is public on the live
product page, appears in the home page's Customer Reviews, and counts in the product's star rating. Submit, look, then **Trash**.

Needs: the staging storefront running image `sha-<tag>` with `CATALOG_SOURCE=woo`; the `kcpw-core` plugin updated to **0.2.0**; a Stripe-free
step (nothing here touches payments).

## 1. Update the plugin on staging

1. Get `kcpw-core.zip` from the CI run on the branch (Artifacts > **kcpw-core-plugin**), or `npm run build:core-plugin`.
2. Plugins > Add New > Upload Plugin > the zip > **Replace current with uploaded** (WordPress offers this when 0.1.0 is installed). Keep it active.
3. WooCommerce > Checkout link (the plugin's status page) still shows Ready. `KCPW_HANDOFF_SECRET` in `wp-config.php` is unchanged.
4. On the storefront host: `curl -s https://<staging>/api/checkout-status/` shows `"plugin":"0.2.0"` (it needs `CHECKOUT_ENABLED=true`, already
   on for staging; if checkout is off you can instead see the version on the plugin's status page).

## 2. Look at WooCommerce's settings

WooCommerce > Settings > Products: _Enable product reviews_ ticked; _Enable star ratings on reviews_ ticked. Decide _Reviews can only be left by
verified owners_ (see step 6). Settings > Discussion > _Email me whenever a comment is held for moderation_ decides whether **you** get an email.

## 3. Switch review writing on (staging only)

On the VPS, in `/opt/kcprintworks-nextjs/.env`: `REVIEWS_SUBMIT_ENABLED=true`. Then `cd /opt/kcprintworks-nextjs && docker compose up -d`.
Open a product page that has reviews switched on: **Write a review** appears under the reviews. (A product with reviews off in WooCommerce
shows nothing.)

## 4. Send one test review

Use your own email address, 5 stars, and the text `TEST ONLY, please ignore and delete. Checking that reviews arrive as pending.` Wait a few
seconds after the page loads (the form refuses a send within 3 seconds), then Send. Expected:

- [ ] The page says "Thank you! We've received your review. It will appear on this page once we've approved it."
- [ ] WordPress admin > Products > Reviews > **Pending** lists it, with 5 stars, your name, and your email.
- [ ] It says _Verified owner_ only if your email has an order for that product (WooCommerce decides).
- [ ] The product page does **not** show it, after a reload and after waiting two minutes.
- [ ] `https://<your-shop>/wp-json/wc/store/v1/products/reviews?product_id=<id>` does not list it.
- [ ] The product's average and count did not change.
- [ ] No email reached the customer address (you may get the admin "waiting for moderation" email: that is WordPress notifying you).

Then **Trash** it (Products > Reviews > Pending > Trash), and empty the trash.

## 5. Things that should be refused

- [ ] Send the form with nothing filled in: the error list appears, nothing reaches WordPress (no new Pending review).
- [ ] A review text with `https://example.com` in it: asked to leave web addresses out.
- [ ] Send a second review for the same product with the same email: the same thank-you appears, but **no second** Pending review (trash the first one first, then repeat step 4 once, if you want to see it again).
- [ ] Send four reviews quickly from one browser: the fourth says "Too many reviews were sent".

## 6. "Only verified owners" (optional, one change in WooCommerce)

Tick _Reviews can only be left by verified owners_, send a review with an email that has no order for that product: the form says only customers
who bought it can review. Send it with an email from a real order: it is saved as Pending. Untick the setting again if you want it off.

## 7. If something does not match

| You see | Likely cause |
|---|---|
| No "Write a review" | `REVIEWS_SUBMIT_ENABLED` is not `true`, the secret is shorter than 32 characters, or reviews are off for that product. `docker logs kcprintworks-nextjs` shows one line naming the missing setting (never a value) |
| "We could not save your review right now" | The plugin is older than 0.2.0 (no reviews route), the secret differs from `wp-config.php`, or the shop is unreachable. The container log has one line saying which, with no review text |
| Thank-you shown but nothing in Pending | The review was a duplicate (same email, same product), or WordPress filed it as spam (Products > Reviews > Spam) |
| It appears as Approved straight away | **Stop and tell us.** The plugin forces Pending whatever the Discussion settings say; if a real WordPress approves anyway, some other plugin overrides it. Trash it |

## 8. Switching it back off

`REVIEWS_SUBMIT_ENABLED=false` (or remove the line) and `docker compose up -d`. The form disappears; reviews already approved stay.
