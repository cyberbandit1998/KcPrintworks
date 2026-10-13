# Duplicate Products: Keeper Recommendations (provisional)

Generated from the owner's product export (2026-10-13) by
[`scripts/discovery/duplicate-report.mjs`](../../scripts/discovery/duplicate-report.mjs). Machine-readable summary:
[`duplicate-recommendations.csv`](duplicate-recommendations.csv). Regenerate after any new export, and again with the REST dump
(`--rest`) once it exists: `node scripts/discovery/duplicate-report.mjs docs/discovery/raw/products.csv --rest docs/discovery/raw/wc-products.json`.

## How the duplicates probably came about (inferred)

Image upload folders, image filenames, and the description footer suggest three waves:

1. **May 2026:** five draft products (#24, #26, #32, #36, #42) with a single Etsy-style image each. All five are superseded.
2. **May to July 2026:** the curated catalog. Hand-organized: real categories, about 13 tags per product, sale prices, 24-character image filenames.
3. **September 2026:** a re-import through **ExportYourStore.com** (18 products, IDs 681 to 889). Each description ends with the visible
   text "Listed with ExportYourStore.com", most images keep Etsy filenames (`il_fullxfull...`), tags are empty, categories are "Uncategorized",
   and the Etsy-style attributes (Condition, MPN) are added. **12 of these re-imported products duplicate a curated one; 6 are genuinely new**
   (#688, #698, #763, #863, #877, #889).

So in **all 12** decision groups the newer copy is the import (it carries the footer) and the older copy is the curated listing.

## What this recommendation is and is not

- It compares what the export contains: text (identical apart from whitespace and the footer in every pair checked), price, image counts,
  category, tags, structure, SKU style, upload month, and the import footer.
- It **cannot** compare URLs, sales history, reviews, search traffic, or which URL Google/Meta/Klaviyo already use. Those are the signals that
  decide a real keeper, because they cannot be moved between products, while categories and tags can be copied in minutes. That is why no
  group is rated High yet.
- **Where the per-product SEO is stored is unknown** (13 custom SEO plugins, no SEO plugin; see [PLUGINS.md](PLUGINS.md) P5). If any is keyed
  to one product ID, that copy gains weight. Q10 asks for the plugin source.

## Notes the script cannot make

- **Taco Cat (#196, #744, #32 draft):** #196 is a simple product and #744 is a variable one (single vs double deck, two prices), so they are
  not interchangeable. #652 ("Taco-Double") has a similar title and the same two prices as #744, so #652 and #744 are probably separate Etsy
  listings (single and double deck), not duplicates. Rated Low; needs the owner.
- **3 Up 3 Down (#187, #733):** #187 sits in "Desk Toys", which looks wrong for a card game; fix the category on whichever copy is kept.
- **Skip-Bo (#124), Phase 10 (#140), Scrabble Slam (#228):** each has one published copy and a draft; the drafts are superseded and not
  public. No decision beyond whether to leave the drafts.
- **Etsy link:** the numeric part of the newer SKUs (e.g. `29694849018_...`) might be an Etsy listing or product ID (unverified). If the older
  copy is kept, that number is recorded in the Etsy mapping table as a candidate link, **without editing any SKU**.

## If you approve a group, the safe order is (each step needs your approval)

1. On **staging**, copy anything useful from the retired copy to the keeper (for example the Etsy-style attributes, if you want them).
2. Confirm the keeper's URL, then add a **301 from the retired URL to the keeper** at the new storefront (not on the live site).
3. Unpublish (not delete) the retired copy at cutover, keeping it recoverable for 30 days.
4. Update the Google, Meta, and Klaviyo feeds to the keeper.


> **Recommendations only. Nothing has been merged, deleted, unpublished, or redirected, and none of it will be without the owner's explicit approval.**

Evidence used: the product export only. It has **no URLs/slugs, sales history, reviews, or search traffic**, so every recommendation below is provisional. Run `scripts/discovery/fetch-wc-catalog.mjs` and re-run this report to add them.

## Summary

- Duplicate groups: 15. Groups with two or more published copies (a keeper decision is needed): **12**. Groups that are one published product plus old drafts: 3.
- Confidence: High 0, Medium 11, Low 1 (among groups needing a decision).

## What would change a recommendation

- Either copy has sales, reviews, or inbound/search traffic the other lacks (needs the REST dump and Search Console).
- One copy's URL is the one in Google Merchant Center, Meta, or Klaviyo feeds.
- The custom SEO plugins hold per-product meta keyed to one product ID (see PLUGINS.md P5).
- The numeric part of the newer SKU is confirmed to be the Etsy listing/product ID and you want to keep that link on the product itself.

## How the recommendation is made

Published beats draft. Evidence that cannot be moved to another product outweighs evidence that is easy to copy. With REST data: more recorded sales (+5) and more reviews (+4) than the other copies. Always: a real category (+1), five or more tags (+1), lowest ID / oldest (+1), a visible import footer (-1), a numbered slug (-1). Confidence drops to Low when the copies have different structures, different descriptions, or tie, and cannot reach High without REST data. The scores only order the copies; read the reasons.

## Skip-Bo Card Game Travel Case: Durable Storage Box & Card Holder

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #24 | simple | draft | none | 0 | 13.99 (10.49) | - | 1 (etsy-style names; 2026/05) | Game Night | 4 | no |
| #124 | variable | published | readable | 7 | - (-) | - | 8 (other names; 2026/05) | Uncategorized | 13 | no |

**Keeper: #124** (confidence High). Only one published copy; the other member(s) are unpublished drafts. No decision needed beyond what to do with the drafts.

Drafts: #24 (not public; no action needed unless you want them removed).

## 3D Printed Phase 10 Card Case: Durable Travel Organizer

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #26 | simple | draft | none | 0 | 11.99 (8.99) | - | 1 (etsy-style names; 2026/05) | Game Night | 3 | no |
| #140 | variable | published | readable | 8 | - (-) | - | 9 (other names; 2026/05) | Uncategorized | 13 | no |

**Keeper: #140** (confidence High). Only one published copy; the other member(s) are unpublished drafts. No decision needed beyond what to do with the drafts.

Drafts: #26 (not public; no action needed unless you want them removed).

## Taco Cat Goat Cheese Pizza Card Game Box | 3D Printed Organizer

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #32 | simple | draft | none | 0 | 12.99 (9.74) | - | 1 (etsy-style names; 2026/05) | Game Night | 3 | no |
| #196 | simple | published | random-looking | 0 | 12.99 (9.99) | 20 | 8 (other names; 2026/05) | Game Night | 13 | no |
| #744 | variable | published | readable | 2 | - (-) | - | 10 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #196** (confidence **Low**). Candidate(s) to retire later: #744; drafts: #32.

Why:
- #196: has a real category (Game Night), easy to copy to the keeper
- #196: 13 tags (easy to copy to the keeper)
- #196: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #744: only "Uncategorized"
- #744: 0 tags
- #744: visible "Listed with ExportYourStore.com" footer (easy to remove)
- The copies have different structures (simple vs variable, or different variation counts), so they are not interchangeable; compare what each sells before choosing.
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## 3 Up 3 Down Card Game Box – 3D Printed Travel Case

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #36 | simple | draft | none | 0 | 12.99 (9.74) | - | 1 (etsy-style names; 2026/05) | Game Night | 3 | no |
| #187 | simple | published | random-looking | 0 | 14.89 (9.99) | 50 | 7 (other names; 2026/05) | Desk Toys | 13 | no |
| #733 | simple | published | readable | 0 | 14.89 (-) | 45 | 7 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #187** (confidence **Medium**). Candidate(s) to retire later: #733; drafts: #36.

Why:
- #187: has a real category (Desk Toys), easy to copy to the keeper
- #187: 13 tags (easy to copy to the keeper)
- #187: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #733: only "Uncategorized"
- #733: 0 tags
- #733: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## Scrabble Slam 3D Printed Storage Case – Compact Travel Organizer

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #42 | simple | draft | none | 0 | 12.99 (9.74) | - | 1 (etsy-style names; 2026/05) | Game Night | 3 | no |
| #228 | simple | published | readable | 0 | 13.64 (-) | 30 | 6 (other names; 2026/05) | Uncategorized | 13 | no |

**Keeper: #228** (confidence High). Only one published copy; the other member(s) are unpublished drafts. No decision needed beyond what to do with the drafts.

Drafts: #42 (not public; no action needed unless you want them removed).

## AAA Battery Storage Box – Compact Organizer Case

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #265 | simple | published | random-looking | 0 | 11.59 (9.99) | 10 | 5 (other names; 2026/05) | HomeGoods | 13 | no |
| #755 | simple | published | numeric-prefix | 0 | 11.59 (-) | 20 | 5 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #265** (confidence **Medium**). Candidate(s) to retire later: #755.

Why:
- #265: has a real category (HomeGoods), easy to copy to the keeper
- #265: 13 tags (easy to copy to the keeper)
- #265: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #755: only "Uncategorized"
- #755: 0 tags
- #755: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## 3D Printed The Mind Storage Box, Bunny Illustration Mini Organizer Case

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #272 | simple | published | random-looking | 0 | 12.59 (10.44) | 10 | 6 (other names; 2026/05) | Card Games | 12 | no |
| #818 | simple | published | numeric-prefix | 0 | 12.59 (-) | 23 | 6 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #272** (confidence **Medium**). Candidate(s) to retire later: #818.

Why:
- #272: has a real category (Card Games), easy to copy to the keeper
- #272: 12 tags (easy to copy to the keeper)
- #272: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #818: only "Uncategorized"
- #818: 0 tags
- #818: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## 9V Battery Storage Box Organizer, 3D Printed Holder Case

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #293 | simple | published | random-looking | 0 | 13.64 (10.74) | 25 | 6 (other names; 2026/05) | HomeGoods | 13 | no |
| #832 | simple | published | numeric-prefix | 0 | 13.64 (-) | 25 | 6 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #293** (confidence **Medium**). Candidate(s) to retire later: #832.

Why:
- #293: has a real category (HomeGoods), easy to copy to the keeper
- #293: 13 tags (easy to copy to the keeper)
- #293: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #832: only "Uncategorized"
- #832: 0 tags
- #832: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## AA Battery Storage Box Organizer, Home Organization Case

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #300 | simple | published | random-looking | 0 | 13.64 (11.23) | 25 | 6 (other names; 2026/05) | Boxes & Bins | 13 | no |
| #825 | simple | published | numeric-prefix | 0 | 13.64 (-) | 21 | 6 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #300** (confidence **Medium**). Candidate(s) to retire later: #825.

Why:
- #300: has a real category (Boxes & Bins), easy to copy to the keeper
- #300: 13 tags (easy to copy to the keeper)
- #300: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #825: only "Uncategorized"
- #825: 0 tags
- #825: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## Clue Card Game Storage Case | Compact Travel Organizer, Board Game Accessory

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #388 | simple | published | random-looking | 0 | 14.89 (11.23) | 21 | 4 (other names; 2026/05) | Card Games | 13 | no |
| #837 | simple | published | numeric-prefix | 0 | 14.89 (-) | 20 | 4 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #388** (confidence **Medium**). Candidate(s) to retire later: #837.

Why:
- #388: has a real category (Card Games), easy to copy to the keeper
- #388: 13 tags (easy to copy to the keeper)
- #388: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #837: only "Uncategorized"
- #837: 0 tags
- #837: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## Vintage Skip-Bo Logo Card Game Storage Case | Travel Friendly

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #396 | simple | published | random-looking | 0 | 13.89 (10.48) | 20 | 7 (other names; 2026/05) | Card Games | 13 | no |
| #724 | simple | published | numeric-prefix | 0 | 13.89 (-) | 20 | 7 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #396** (confidence **Medium**). Candidate(s) to retire later: #724.

Why:
- #396: has a real category (Card Games), easy to copy to the keeper
- #396: 13 tags (easy to copy to the keeper)
- #396: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #724: only "Uncategorized"
- #724: 0 tags
- #724: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## Beat The Heat Card Game 3D Printed Travel Case | Orange Blue Organizer Box

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #410 | simple | published | random-looking | 0 | 12.64 (10.48) | 10 | 6 (other names; 2026/05) | Card Games | 13 | no |
| #716 | simple | published | numeric-prefix | 0 | 12.64 (-) | 20 | 6 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #410** (confidence **Medium**). Candidate(s) to retire later: #716.

Why:
- #410: has a real category (Card Games), easy to copy to the keeper
- #410: 13 tags (easy to copy to the keeper)
- #410: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #716: only "Uncategorized"
- #716: 0 tags
- #716: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## The Chameleon Board Game Storage Case | Organizer with Latches, Travel Friendly

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #431 | simple | published | readable | 0 | 22.05 (17.54) | 9 | 4 (other names; 2026/05) | Card Games | 12 | no |
| #851 | simple | published | numeric-prefix | 0 | 22.05 (-) | 20 | 4 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #431** (confidence **Medium**). Candidate(s) to retire later: #851.

Why:
- #431: has a real category (Card Games), easy to copy to the keeper
- #431: 12 tags (easy to copy to the keeper)
- #431: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #851: only "Uncategorized"
- #851: 0 tags
- #851: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## TACTA Game Storage Box – Compact 3D Printed Card Token Holder – Travel Accessory

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #440 | simple | published | random-looking | 0 | 12.99 (10.74) | 2 | 8 (other names; 2026/05) | Card Games | 13 | no |
| #846 | simple | published | numeric-prefix | 0 | 12.99 (-) | 20 | 8 (etsy-style names; 2026/09) | Uncategorized | 0 | yes |

**Recommended keeper: #440** (confidence **Medium**). Candidate(s) to retire later: #846.

Why:
- #440: has a real category (Card Games), easy to copy to the keeper
- #440: 13 tags (easy to copy to the keeper)
- #440: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #846: only "Uncategorized"
- #846: 0 tags
- #846: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

## Monopoly Deal No Mercy 3D Printed Card Case, Travel Game Storage Organizer

| ID | Type | State | SKU style | Variations | Price (sale) | Stock | Images | Category | Tags | Import footer |
|---|---|---|---|---|---|---|---|---|---|---|
| #595 | simple | published | random-looking | 0 | 12.99 (10.74) | 50 | 7 (other names; 2026/07) | Card Games | 13 | no |
| #681 | simple | published | numeric-prefix | 0 | 12.99 (-) | 44 | 7 (etsy-style names; 2026/09) | Card Games | 0 | yes |

**Recommended keeper: #595** (confidence **Medium**). Candidate(s) to retire later: #681.

Why:
- #595: has a real category (Card Games), easy to copy to the keeper
- #595: 13 tags (easy to copy to the keeper)
- #595: oldest published copy (lowest ID), likely the longest-indexed URL (unverified)
- #681: has a real category (Card Games), easy to copy to the keeper
- #681: 0 tags
- #681: visible "Listed with ExportYourStore.com" footer (easy to remove)
- Descriptions are the same text apart from layout and the import footer (similarity 100%).

Approval needed before any of: copying data from the retired copy to the keeper, unpublishing, trashing, or adding a 301 redirect from the retired URL to the keeper.

