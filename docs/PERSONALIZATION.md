# Personalization: investigation and the safest implementation

Status: **recommendation for your approval** (ADR-007). Nothing has been changed on the live site. The new storefront already renders the
form from the plugin-agnostic schema; what is left is where the field definitions and the saved values live in WooCommerce.

## 1. What I found

| Question                                    | Answer                                                                                                                                                                                                                                                                  | Evidence                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Is a personalization or add-on plugin installed? | **No.** None of the 79 plugins is a product-add-on or product-field plugin, and none of the 61 custom plugins is described as handling it.                                                                                                                       | Plugins screen (PLUGINS.md P1) |
| How do buyers give the name today?          | **Probably in the checkout order notes** ("enter your Name / Emoji / Cable Color in the personalization box ... entered during checkout"). Order notes belong to the **whole order**, not to one item. **Inferred, not confirmed.** An order sample (Q3) settles it.   | Product text (INVENTORY F6)    |
| Is there customer file upload?              | **No sign of it.** I have not assumed it and have not built it.                                                                                                                                                                                                         | Export and plugin list         |
| Which products ask for personalization?     | #889 bag tag (name, emoji, tag color, text color, cable color), #698 keychain, #423 Euchre, #863 playing-card box, #553 card box, #89 ("message us"), and every title containing "Personalized" or "Custom Name".                                                          | Export                         |

**The risk this exposes:** if a customer buys two bag tags with different names and the names live in one order note, nothing ties each name to its item.
The packing slip, the print queue, and any automation have to guess. Per-item storage is the single most valuable change here.

## 2. Requirements (yours, plus the ones that follow from them)

1. Individual options saved **on each WooCommerce order item**, readable in the admin, emails, and packing slips.
2. Each personalization is its own cart line; the same product with different choices never merges.
3. **Server-side validation** and pricing. The browser is never trusted; a price effect is a display hint.
4. Customer-chosen text must be safe to print (length, characters) and safe to store.
5. Works with the headless storefront (no theme-rendered form) and with the cart handoff to the WooCommerce checkout.
6. No uploads unless existing products use them (they do not).

## 3. Options compared

| Criterion                              | A. Third-party add-on plugin (paid or free)                                                                                  | B. First-party module in `kcpw-core`                                                                         | C. Keep order notes                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Saved per order item                   | Yes, in most                                                                                                                 | Yes (we define it)                                                                                           | **No**                               |
| Server-side validation we can test     | Plugin-defined rules; our shared vectors may not match                                                                       | **Exactly our rules**, proven against the shared vectors                                                     | None                                 |
| Works headless (REST/DTO)              | Varies; often renders its form in the theme. Needs verification per plugin                                                   | **Yes**, the DTO carries the schema                                                                          | n/a                                  |
| Price effects                          | Plugin feature                                                                                                               | Ours, computed server-side, tested                                                                           | None                                 |
| Cost and lock-in                       | Licence fee, another vendor in the checkout path                                                                             | Our code to maintain (small: one meta box, one validator, one cart filter)                                  | Free                                 |
| Security surface                       | A large third-party plugin on the cart and checkout                                                                          | Small and reviewable; every rule has a test                                                                  | Smallest                             |
| Fits a 61-custom-plugin site           | Adds a 62nd moving part                                                                                                      | Replaces ad hoc handling and fits the planned `kcpw-core`                                                    | Status quo                           |

**Recommendation: B, a first-party module in `kcpw-core`.** There is no existing plugin to adapt (so A is not a migration, just a new dependency), C fails
requirement 1, and B is the only option whose behavior is covered by the tests that already exist. Confidence: **high** on "not C", **medium-high** on B over A. If you
already own an add-on licence you like, tell me; the storefront does not change either way because it renders from the schema.

## 4. How B works (design)

**Field definitions** (per product, edited by you in WordPress admin)

- A "Personalization" box on the product edit screen holds the field list: text, long text, choice (select or radio), and checkbox, with limits and optional price effects.
  Stored as one versioned JSON value in product meta (`_kcpw_option_schema`), validated against the same schema the storefront uses (`packages/contracts/src/options.ts`).
- Reusable choice lists (for example the 13 tag colors) are defined once and referenced, so adding a color is one edit, not 169 variations.

**Saving a choice**

- The cart handoff carries `{ productId, variationId?, attributes?, quantity, options }`, never prices.
- WooCommerce (`kcpw-core`) **re-validates** every option against the product's schema on `add_to_cart` and again at checkout. Unknown fields, bad choices, bad lengths,
  and unprintable characters are rejected with the same issue codes the storefront shows.
- Each distinct set of options becomes its own cart line (the line key includes the options).
- On order creation the values are written to the **order item** as visible meta (label and readable value, for example `Tag color: Navy`, `Name: Robin`) plus one hidden
  record, `_kcpw_personalization`, holding `{ schema_version, values }` for automation. Emails, the admin order screen, and packing slips show the visible lines.

**Pricing**

- Option price effects are computed server-side from the **base price of the chosen variation** (percent effects are of the base, not compounded) and added to the line
  price in `woocommerce_before_calculate_totals`. The storefront shows the same number as a preview; WooCommerce is the authority.

**Proofing (recommended, small)**

- A confirmation line on the product page ("Printed exactly as typed: Robin") and a copy of the text in the order email, so a typo is caught before printing.

## 5. The bag tag, concretely

Today: 169 variations (13 tag colors x 13 text colors), every attribute blank ("Any"), all at one price, and the name, emoji, and cable color typed into a notes box.

Proposed (a simple product, no variations):

| Field          | Type                | Notes                                                                                                                     |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tag color      | choice (13)         | The 13 existing tag colors                                                                                                |
| Text color     | choice (13)         | The 13 existing text colors (named "Text + Emoji Color" today)                                                            |
| Cable color    | choice              | **I do not know your cable colors.** Needs your list                                                                      |
| Icon           | choice (recommended) or free emoji | See section 6                                                                                                  |
| Name or text   | text, 1 to N chars  | N from the print area; the proposal shows 24                                                                              |

Same price, one product page, nothing slow to load, and every choice saved on the order item. The storefront preview already shows this shape for the real product
(the fixtures `sample-bag-tag` and `sample-bag-tag-as-imported` prove both representations work and stay light).

Until you approve the change, **the 169 variations stay exactly as they are**; the new storefront reads them as one "Any" variation and still shows the two color pickers, and the
customer's choices travel with the cart line.

## 6. Decisions I need from you

1. **Icons.** A 3D printer can only print shapes it has. Free emoji (anything a keyboard can type) cannot all be printed, and many emoji are sequences joined by an invisible
   "zero-width joiner" that the current validator **deliberately rejects** (it is one of the invisible characters that corrupt print files; the shared vectors lock this in).
   **Recommendation: a curated icon list you can actually print**, shown as pictures, stored as a name. If you prefer typed emoji, I will add a narrow, explicit allowance
   for emoji sequences on that one field and test it. Which one?
2. **Cable colors:** the list.
3. **Order sample (Q3):** one recent bag-tag or keychain order with the customer details removed, so I can see exactly how the name arrives today and migrate the wording.
4. **Per-product maximum lengths** (print area), starting with the bag tag and keychain.
5. **Approval to build `kcpw-core` personalization** on staging (no change to the live store).

## 7. Shared test vectors (done)

`packages/contracts/test/vectors/options.json` holds 33 cases generated from the TypeScript reference: valid input, every issue code, trimming, NFC, code-point counting
(emoji count once), invisible and bidi characters, newline rules, and price rounding including exact half-cent cases. A test fails if the reference and the file ever diverge.
The PHP module must reproduce every `expected` block exactly; that is the definition of "the server validates the same way the storefront does". While writing them I fixed one
reference bug: a string, array, or null passed as the options object was read character by character; it is now rejected as a whole.

## 8. Migration and rollout (all on staging first)

1. Build the schema box and validator in `kcpw-core` on a staging copy; run the vectors in PHP.
2. Define fields for the personalized products (#889 first), without touching their variations.
3. Add the cart and order-item handling; place test orders in Stripe test mode and check the admin, email, and packing slip show each item's choices.
4. Compare with a parity report: every existing variation still resolves to the same price and stock status.
5. You review on staging. **Only then** do we discuss changing the live products, with a full export taken first (the rollback).
