# Product search

Status: built and tested (unit, browser, accessibility). It reads only the catalog the storefront already holds in memory, so it adds **no** request to WooCommerce or WordPress and needs
**no** setting to work. Decision record: [ADR-022](DECISIONS.md).

## What a shopper sees

- A **search icon next to Cart** in the header, on desktop and on phones. It opens a panel (a plain `<details>` disclosure with a real GET form, so it also works without JavaScript) with the
  placeholder "Search games, cases, gifts...". As they type, up to six results appear live with **image, name, price and category**, and a **"View All Results"** link to `/search/`.
- **Keyboard:** Enter on the icon (or Space) opens it and focuses the field; ↓ and ↑ move through results (the field keeps focus and says which one is current), Enter opens the current result or, with none chosen,
  runs the full search; Escape closes the panel and returns focus to the icon. Results are announced to screen readers ("5 results").
- **`/search/?q=…`:** the result count, **category filters** (only categories that have matches, with counts), responsive product cards (the same cards as the shop), paging, and a **Clear search** link.
- **No match:** "No products match …" and **"Can't find it? Request a Custom Quote"**, linking to `/custom-orders/?item=<what they typed>` so the form opens with the game or theme already filled in.

## What it searches

Only products the storefront lists: **published and catalog-visible** WooCommerce products. Drafts, private and "hidden" products never appear (they are not in the catalog copy at all).
Matched fields, with weights: name (strongest), SKU, category names, option and attribute values, then the description text (HTML is reduced to words; it is never shown).

Matching is forgiving and predictable:

- Case and accents are ignored ("Café" = "cafe"); simple plurals are ignored ("cases" finds "case").
- Every word typed must match somewhere (AND), as a whole word, a word start ("cat" → "catan"), or inside a longer word.
- **Typos:** words of five letters or more tolerate one wrong, missing or extra letter, or two swapped letters ("catann", "settelrs"); words of nine or more tolerate two. Short words and anything with a digit are never fuzzy
  (so "cafe" does not find "case" and "d6" does not find "d8").
- **Game shorthand:** a built-in list of synonyms (for example "mtg" ↔ "magic the gathering", "dnd" ↔ "dungeons and dragons", "deck box" ↔ "deckbox", "organizer" ↔ "organiser" ↔ "insert").
- Phrases that appear together in a name rank higher.

### Your own synonyms (optional)

In the VPS `.env` (run time, no rebuild): `SEARCH_SYNONYMS=mtg=magic the gathering;ttr=ticket to ride;catan=settlers of catan`. Groups are separated by `;`, words inside a group by `=`. A bad entry is ignored. This is a starting
list of tabletop shorthand, not a statement about your catalog; add the names your customers actually use.

## Staying current

The search index is built from the catalog snapshot the storefront already caches, and is rebuilt automatically whenever that snapshot changes (a background refresh every `CATALOG_REVALIDATE_SECONDS`, or the signed
"refresh now" request). **A product you edit in WooCommerce becomes searchable after the next catalog refresh**, exactly like it appears in the shop. Nothing about a search is stored or logged.

## Speed and limits

Answered from memory in well under a millisecond per query for a catalog of a few hundred products (the index is built once per catalog snapshot). `/api/search/` answers at most eight rows, needs at least two characters,
and is limited to 120 requests a minute per visitor. The panel waits 160 ms after the last keystroke and cancels a request that is no longer needed.

## SEO

`/search/` is `noindex,follow` for result pages (search results should not compete with category pages), has a canonical address, and the site declares a `WebSite` `SearchAction` in its structured data so search engines know the search exists.

## Tests

`tests/unit/search.test.ts` (engine, typos, synonyms, refresh behavior), `tests/unit/search-route.test.ts` (API), `tests/e2e/search.spec.ts` (header, panel, keyboard, screen-reader text, results page, phone widths, without JavaScript) and
the "search follows the catalog" block in `tests/e2e/woo-catalog.spec.ts` (a renamed, published or unpublished product changes results only after a refresh, and searching asks WooCommerce nothing).
