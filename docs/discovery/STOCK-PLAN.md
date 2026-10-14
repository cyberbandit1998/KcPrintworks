# Inventory Recommendations (for review)

**No inventory setting has been changed**, on the live site or anywhere else. Generated from the product export by
[`scripts/discovery/inventory-recommendations.mjs`](../../scripts/discovery/inventory-recommendations.mjs). Per-product detail, with an empty
`owner_decision` column for you to fill in, is [`stock-plan.csv`](stock-plan.csv).

## The situation today (observed)

- **All 66 published products manage stock** (307 rows carry a quantity), with backorders off.
- The quantities are mostly importer defaults, not counts: **173 rows are exactly 15 and 55 are exactly 20**. A made-to-order item with a
  default quantity has no real stock to track.
- WooCommerce subtracts one per sale and marks the item **out of stock at zero**. For a product you can always print, that wrongly stops sales.
- A custom plugin, "Variable Parent Stock Guard", exists to stop variable parents from showing out of stock while a variation is in stock. That is a
  workaround for stock settings that do not match how you sell.

## Recommendation

| Recommendation | Products | Meaning |
|---|---|---|
| **Disable stock management (made to order)** | **59** | Turn "Manage stock" off, leave status "In stock". Nothing counts down. |
| **Track only specific variations** | **4** (#63, #124, #140, #157) | The plain case is made to order; the **"+ Deck"** options include a deck or cards you presumably buy, so those variations (and only those) track real stock = decks on hand. |
| **Ask the owner** | **3** (#561, #587, #877) | A puzzle sold by piece count, a Flip 7 combo box, and a three-case bundle: depends on whether the parts are printed to order or shelved. |

Variations recommended for real tracking (matched on SKU; confirm each includes a purchased deck):

| Product | "+ Deck" variation SKUs |
|---|---|
| #63 Flip 7 | `FLIP7-CASE-DECK` |
| #124 Skip-Bo | `SKIPBO-BLUE-CASE-DECK`, `SKIPBO-RED-CASE-DECK`, `SKIPBO-BLUE-CASE-DECK_GreenBD568` |
| #140 Phase 10 | `PHASE10-BLUE-CASE-DECK`, `PHASE10-BLACK-CASE-DECK`, `PHASE10-RED-CASE-DECK`, `PHASE10-GREEN-CASE-DECK` |
| #157 Monopoly Deal | `MON-DEAL-CASE-DECK` |

"Single Deck / Double Deck" in attributes such as Box Size or Size means the box **holds** that many decks; it is not a purchased deck, and the script does not
treat it as one.

## Urgent-looking items on the live store (observed, nothing changed)

These made-to-order items have small counts and could stop selling after a few orders:

| Product | Quantity today |
|---|---|
| #440 TACTA | **2** |
| #561 Donut Jigsaw Puzzle | 5 (ask) |
| #246 Flip 7 With a Vengeance | 6 |
| #652 Taco Cat (double deck) | 8 |
| #174 Phase 10 Flip, #238 9mm box, #431 Chameleon, #553 custom card box | 9 |

The owner decides whether any of these quantities are real. If not, disabling stock management removes the risk.

## Why not keep counts "just in case"

A count that is not a real count is worse than no count: it can switch a product off for no reason and it hides the real constraint (print time).
If you want a limit, the honest tool is a **maximum quantity per order** or a lead-time message, not fake stock. The new storefront already shows lead time for
made-to-order products and ignores stock for them.

## Etsy sync interplay

Etsy keeps its own quantity per listing. The Etsy plugin defaults every product to the `made_to_order` rule: **Etsy quantities are not imported into
WooCommerce and WooCommerce quantities are never pushed to Etsy.** For the 4 tracked products, a "shared pool" rule can be switched on later (WooCommerce to Etsy
needs write access and your approval). See SYNC-INDEPENDENCE.md (stock is WooCommerce's to decide; a sync service may overwrite it).

## Owner checkpoints

1. Do you ever print items ahead and shelve them? Which ones? (Mark `track` in the CSV.)
2. Do the "+ Deck" and "+ Cards" options include a deck you buy? How many do you keep?
3. Are #561, #587, #877 printed to order?
4. Are the non-default quantities on **45 products** real counts, sales-reduced numbers, or leftovers? (The CSV lists them.)

## How it would be applied (later, only with your approval)

1. On **staging**: bulk-edit "Manage stock" off for the approved products by SKU, keep tracking on the approved variations. Place a test order for one product and check it never goes out of stock.
2. Review the storefront build, the "Variable Parent Stock Guard" plugin becomes unnecessary and can be retired.
3. Apply to production at cutover from the same reviewed list, after a full export (the rollback).
