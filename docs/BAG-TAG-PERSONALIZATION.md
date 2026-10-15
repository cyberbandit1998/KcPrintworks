# Personalized bag tag: what the customer enters, where it is saved, and the one setup the shop needs

Status: **storefront wording fixed and tested; the shop-side step below is yours** (I never write to your WooCommerce products). Verified here with stand-ins only: the sandbox cannot reach your
WordPress, WooCommerce or Stripe, so the last check is the one test order in section 5.

## 1. What the customer sees

On the bag tag's page, the existing color choices (tag color, text color) are unchanged, and the three personalization fields read:

| Field                | Instruction shown under the field                                | Required |
| -------------------- | ---------------------------------------------------------------- | -------- |
| Name or short text   | Enter the name exactly as you'd like it printed.                 | yes      |
| Icon                 | Enter an available icon name, such as Dog, Cat, or Flower.       | no       |
| Cable color          | Enter your preferred cable color.                                | no       |

(The Icon field used to be "Icon (emoji)" limited to four characters; it now takes a name of up to 24 characters, so "Flower" fits. Prices and the color choices are unchanged.)

## 2. Where each choice is saved, and who sees it

| Step                                    | What holds the choices                                                                                                   | Who sees them                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Storefront cart                         | One cart line per different set of choices (two bag tags with different names never merge); kept in the shopper's browser | The shopper, in the cart                                              |
| Checkout button                         | Sent to the shop, server to server and signed, with the choices only (never a price)                                      | Nobody (it is checked, not shown)                                     |
| Shop (the `kcpw-core` plugin)           | Checked again against the product's **stored** setup, then stored behind a single-use 10-minute link                       | Refused if the product has no stored setup (section 3)                |
| WooCommerce cart and checkout           | Shown as item details in the order summary                                                                               | The shopper                                                           |
| The order                               | One readable line per field on the order item, for example **Name or short text: Robin**, **Icon: Flower**, **Cable color: Black**, plus one hidden record for automation | You: the WooCommerce order screen, order emails, packing slips        |

A field the shopper leaves empty (Icon, Cable color) is simply not listed.

## 3. The one thing the shop needs: the setup stored on the product

The shop only accepts personalization for a product whose setup is **stored on that product** in WooCommerce (its _Personalization_ tab). It does not guess. If the bag tag has no stored
setup, the page still shows the three default fields above (that is what you saw, with development wording, before this change), but at checkout the shop refuses them, and the shopper reads
"The personalization options for this item are not available to order online right now. Please contact us and we will help." (It used to read `Unknown option "name"`.)

**How to tell whether this applies to your bag tag:** open `https://kcprintworks.com/api/catalog-status/`. The list `defaultPersonalization` names every product that is showing the default fields
because WooCommerce stores no setup for it. If the bag tag is listed, do section 4.

## 4. Store the setup (about two minutes, no code and no plugin update)

1. WordPress admin > _Products_ > the bag tag > _Product data_ box > the **Personalization** tab.
2. Open **Advanced: copy this setup to another product (JSON)**, select everything in the box, and paste this over it:

```json
{"version":1,"fields":[{"id":"name","type":"text","label":"Name or short text","required":true,"helpText":"Enter the name exactly as you'd like it printed.","minLength":1,"maxLength":24,"placeholder":"e.g. Robin"},{"id":"icon","type":"text","label":"Icon","required":false,"helpText":"Enter an available icon name, such as Dog, Cat, or Flower.","minLength":0,"maxLength":24,"placeholder":"e.g. Dog"},{"id":"cable_color","type":"text","label":"Cable color","required":false,"helpText":"Enter your preferred cable color.","minLength":0,"maxLength":30}]}
```

3. Click **Update** on the product. The table above the box now shows the three fields. (A bad paste is refused with a message and what was saved before stays as it was.)
4. Within two minutes (or press the refresh described in [WOOCOMMERCE-CATALOG.md](WOOCOMMERCE-CATALOG.md) section 3) the product no longer appears in `defaultPersonalization`, and the page shows your stored wording.

You can edit the wording, the limits, or turn a field into a choice list (for example a fixed list of icons you can print, or your real cable colors) in the same tab; the storefront follows what is stored.
For another personalized product that only needs a name, keep only the first field.
A sync tool might overwrite product meta where the setup is stored: after the next sync, check that it survived (this JSON is the backup).

## 5. One test order proves it (do this once)

1. On the storefront, choose the bag tag's colors, enter a name, an icon (say Flower) and a cable color, add it to the cart, and press Checkout.
2. On the WooCommerce checkout, the order summary lists the three choices under the bag tag.
3. Place one order the way [CHECKOUT-PRODUCTION.md](CHECKOUT-PRODUCTION.md) section 6 describes (a Stripe test card while Stripe is in test mode, otherwise one real low-value order that you refund).
4. Open the order in WooCommerce: the bag tag line shows **Name or short text**, **Icon** and **Cable color** with exactly what was typed. Check the order email, too.

## 6. What is verified, and what is not

Verified here: the three instructions are exactly the wording above and no field carries a development note (a test scans the customer-facing code for such wording); the Icon field accepts "Dog", "Cat" and "Flower";
a cart keeps every choice and never merges lines with different choices; the shop's `kcpw-core` code accepts the JSON in section 4, validates the three choices, and saves them on the order item as readable lines plus the hidden record
(PHP tests with WordPress stand-ins); a shop refusal reads in plain words. The JSON in this file is checked against the storefront's default fields, so the two cannot drift.

**Not verified:** the real WooCommerce, the real order screen and emails, and whether your bag tag currently has a stored setup (the status page in section 3 tells you).
