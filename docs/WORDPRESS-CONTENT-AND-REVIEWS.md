# The blog, Our Story, Contact, categories, Featured, New Arrivals, and reviews: what to set in WordPress

The storefront shows words and pictures that **you** write in WordPress and WooCommerce. It never writes to either (the one exception, a
customer's review, is saved as _pending_ by the `kcpw-core` plugin and published only when a person approves it). This page says where each
thing comes from, what to do in the WordPress admin, and which server settings exist.

> **What is and is not proven.** The sandbox this was built in cannot reach your WordPress, WooCommerce, or Stripe. Everything here is
> tested against stand-ins written from the documented behavior of the WordPress REST API and WooCommerce's public Store API. The first
> time the real thing is exercised is when you open the staging site; [section 9](#9-what-to-check-first-on-staging) lists exactly what
> to look at. Nothing on this page changes your live site until you choose to.

## 1. Where each part of the site comes from

| On the storefront | Comes from | You manage it in |
|---|---|---|
| Header: Shop, Game Cases, Personalized Gifts, New Arrivals, Blog, Cart | The WooCommerce category list (Game Cases = `game-cases`, Personalized Gifts = `personalized-gifts`) | Products > Categories (you create and assign; the storefront never does) |
| Game Cases page | Products in Game Cases **and its child categories** (Card Games), each once | Product > Product categories |
| Home: Featured Products | Products with the WooCommerce **Featured** star | Products list > click the star |
| Home and `/new-arrivals/`: New Arrivals | The 8 (home) or all (page) products with the **newest publication date**; the "New Arrivals" _category_ is not used | Product > Publish date |
| Home: Customer Reviews; product page reviews and stars | WooCommerce **approved** reviews | Products > Reviews |
| `/blog/`, `/blog/<post>/`, categories, tags | WordPress **posts** | Posts |
| `/our-story/` | The WordPress **page** whose address ends in `our-story` | Pages |
| `/contact/` | The WordPress **page** whose address ends in `contact` | Pages |
| Home: Our Story, Latest from the blog | The same page and the 3 newest posts | Pages, Posts |

If something is missing, the storefront leaves that part out (or says "coming soon" on the page); it never fills the space with made-up text,
made-up reviews, or a made-up rating.

## 2. Pages: Our Story and Contact

1. Pages > Add New. Write the page. Set its address (the "slug", under Permalink in the sidebar) to exactly `our-story` or `contact`.
   To use other addresses, set `OUR_STORY_SLUG` / `CONTACT_PAGE_SLUG` on the server ([section 8](#8-server-settings)).
2. Publish. The storefront shows the new page within about two minutes (see [freshness](#7-how-fresh-is-it)).

What carries over: headings, paragraphs, bold/italic, lists, quotes, links, pictures (kept lazy-loaded), tables, YouTube and Vimeo videos.
What is removed on purpose, because it could be used to attack visitors: scripts, forms and buttons that send data (so a contact **form**
plugin will not appear: write your email address and hours as text instead), styling written into the page, iframes other than YouTube and
Vimeo, and anything WordPress adds only for its own front end.

Our Story: no text is written by the storefront. If the page is not published, the page says "Our story is coming soon" and asks search
engines not to list it, and the home page leaves the section out. The Our Story page also shows the three newest posts and a **Shop Now** button.

## 3. Posts: the blog

- Posts > Add New. A **featured image** becomes the picture on the blog list and the share picture. The **excerpt** (the "Excerpt" box in the
  sidebar) is the short text on cards and the search-engine description; if you leave it empty WordPress writes one from the first words.
- **Categories and tags** make `/blog/category/<slug>/` and `/blog/tag/<slug>/` pages. Category pages are for search engines; tag pages are
  left out of search results (they repeat what the others show). A post left in "Uncategorized" is simply not shown with a category.
- Drafts, scheduled, private, and **password-protected** posts are never shown. Sticky posts are not treated specially.
- The author's name is not shown (a WordPress user name can be a login name); structured data names the shop as author.
- A link in a post to another post, to Our Story, to a product, or to a category is changed to point at the storefront's own page.
- Videos: paste a YouTube or Vimeo link on its own line. They load only when scrolled to, from YouTube's privacy-enhanced domain.

**Search engines and duplicate content.** The storefront's `/blog/` is the public blog. The same posts also exist on the WordPress site itself
(for example `shop.kcprintworks.com/<post>/`). Keep that copy out of search results so the two do not compete: Settings > Reading >
"Discourage search engines from indexing this site" **on the shop host** (WooCommerce checkout pages should not be indexed anyway), or
the equivalent in your SEO plugin. This is your decision on your WordPress; the storefront does not change it.

## 4. Products: Featured, New Arrivals, categories

- **Featured**: Products list > the star beside a product. The home page shows up to 8 starred products, ordered by WooCommerce's manual
  order (Products > Sorting) then newest. **If none is starred the section is not shown**; nothing else is put there.
- **New Arrivals**: nothing to set. The newest products by publication date. To make a product count as new again, change its publish date
  (Publish > Edit). The WooCommerce category called New Arrivals (id 324) is kept out of browsing and is not used.
- **Categories**: you create and assign them. The storefront reads the tree: a parent category's page includes its children's products
  once each; a parent with no products of its own still shows if its children have some. "Uncategorized" is not browsable.
  Header links find a category by its slug (default `game-cases`, `personalized-gifts`) or id; change with `NAV_GAME_CASES` /
  `NAV_PERSONALIZED_GIFTS`. If the category does not exist, that link is left out and `/api/catalog-status/` says which one is missing.

## 5. Reviews

**Showing them.** Product pages show the average and count that WooCommerce reports and the approved reviews (10 a page). The home page
shows the 3 newest approved reviews of products the shop lists. Only reviews with a whole star rating and some text count. A reviewer's name
is shown as first name and the initial of the last name ("Jane D."); a name that looks like an email address is shown as "Customer".
**Verified purchase** appears only when WooCommerce itself marked the review as from a verified owner. There is no store-wide rating, and
no review is ever invented. The product data that search engines read (the stars they may show) uses the same real numbers.

Settings, in WooCommerce > Settings > Products:

| Setting | What the storefront does |
|---|---|
| Enable product reviews | Off: no reviews or form on any product |
| Enable star ratings on reviews | Off: the form is closed (it needs a rating) |
| Reviews can only be left by "verified owners" | On: someone whose email has no order for that product is told only buyers can review it |
| Show "verified owner" label | The storefront decides this itself, from WooCommerce's verified mark |
| Per product: Advanced > Enable reviews | Off: no section for that product |

**Writing them (off by default).** With `REVIEWS_SUBMIT_ENABLED=true` (and the shop address and secret that checkout uses) a product page shows
**Write a review**. What happens to a review:

1. The browser checks it (name, email, rating, text of 10 to 2000 characters, no web addresses) and sends it to the storefront's own server.
2. The server checks it again, requires a signed form token (a few seconds to two hours old), a hidden field left empty, and a request from
   the same site; limits each visitor to 3 and the whole shop to 60 per ten minutes; and passes it to the `kcpw-core` plugin, signed.
3. The plugin checks it again with the same rules, applies the WooCommerce settings above, keeps one review per email per product, and saves
   it as **pending**. It is never published automatically, whatever Settings > Discussion says. A request cannot claim "verified" or "approved".
4. You approve or trash it in **Products > Reviews**. WooCommerce sets the verified mark itself from the email address.

Limits by visitor rely on the address Nginx Proxy Manager reports (`X-Real-IP`, which it sets by default; the last `X-Forwarded-For` entry is the
fallback). If your proxy sends neither, every visitor shares one "unknown" allowance, so check that a second browser can still send a review.

Privacy: the email address goes only to WordPress (as with any comment) and is never shown or put in a page. The visitor's network address is
never sent to WordPress: the storefront sends a keyed hash, used only to limit floods. Nothing about a submission is written to the
storefront's log. WordPress may email **you** that a review is waiting (Settings > Discussion > "Email me whenever a comment is held for
moderation"); no email is sent to the customer.

**Etsy reviews.** None are shown. The storefront has no Etsy connection and reads nothing from Etsy. If your Etsy sync tool already copied
reviews into WooCommerce as ordinary reviews, they are approved reviews like any other and appear with the rest. Whether it did is not known
(only the product export was ever seen). To find out, run these **read-only** queries on the WordPress database (adjust `wp_` if your table
prefix differs; they change nothing):

```sql
SELECT COUNT(*) FROM wp_comments WHERE comment_type = 'review';
SELECT comment_approved, COUNT(*) FROM wp_comments WHERE comment_type = 'review' GROUP BY comment_approved;
SELECT meta_key, COUNT(*) FROM wp_commentmeta GROUP BY meta_key ORDER BY 2 DESC;
SELECT comment_ID, comment_post_ID, comment_author, comment_date, LEFT(comment_content, 60)
  FROM wp_comments WHERE comment_type = 'review' ORDER BY comment_date ASC LIMIT 20;
```

If reviews that came from Etsy exist and you want them labelled as such, send the results (no customer details needed: the meta key names
and counts are enough) and the label can be added from that real data. Nothing is scraped, and no label is guessed.

## 6. What the storefront asks of WordPress and WooCommerce

| Request | Used for | Credential |
|---|---|---|
| `GET /wp-json/wp/v2/posts`, `pages`, `categories`, `tags` | Blog, Our Story, Contact | none (published content is public) |
| `GET /wp-json/wc/store/v1/products/reviews` | Reviews | none (WooCommerce's public Store API lists approved reviews, no emails) |
| `GET /wp-json/wc/v3/products`, `.../categories` | Catalog | the Read-only key (as before) |
| `POST /wp-json/kcpw/v1/reviews` | Saving a review as pending (only when review submission is on) | signed with the shared secret |

Every answer is cached in the container's memory. A visitor is answered from memory; a stale answer is refreshed once in the background; if
WordPress is down the last good copy keeps being shown; an address that WordPress never listed is not asked about at all (so a bot guessing
addresses cannot make the shop call WordPress). The home page waits at most 2.5 seconds for blog and review sections, then draws without them.

## 7. How fresh is it?

New posts, pages, reviews, products and ratings appear within `CATALOG_REVALIDATE_SECONDS` (default 120). To see a change at once, send the
signed refresh to `POST /api/revalidate/` (the same request WooCommerce webhooks and `scripts/verify-catalog-freshness.mjs` use); it now
refreshes WordPress content and reviews too. WordPress has no built-in "post published" webhook; a plugin that can call a URL when a post is
published (signed with `REVALIDATE_SECRET`) can use the same endpoint, but it is optional.

## 8. Server settings

All optional; set in the VPS `.env` (see `deploy/.env.example`); none needs a rebuild, only `docker compose up -d`.

| Setting | Default | Meaning |
|---|---|---|
| `NAV_GAME_CASES`, `NAV_PERSONALIZED_GIFTS` | `game-cases`, `personalized-gifts` | Which WooCommerce category each header link opens (slug or id) |
| `HIDDEN_CATEGORY_SLUGS` | `uncategorized,new-arrivals` | Categories left out of browsing |
| `WP_BASE_URL` | `WC_BASE_URL` | The WordPress site (https) |
| `OUR_STORY_SLUG`, `CONTACT_PAGE_SLUG` | `our-story`, `contact` | Page addresses |
| `BLOG_PER_PAGE` | 9 | Posts per blog page (3 to 24) |
| `HOME_REVIEWS_MIN_RATING` | 1 | Lowest star rating the home page shows (1 to 5). The default shows every approved review |
| `REVIEWS_SUBMIT_ENABLED` | false | Lets shoppers write reviews (needs `kcpw-core` 0.2.0+, `KCPW_API_URL`/`WC_BASE_URL`, `KCPW_HANDOFF_SECRET`) |
| `REVIEWS_RATE_LIMIT`, `REVIEWS_RATE_LIMIT_ALL` | 3, 60 | Reviews per visitor, and in all, per ten minutes |

`GET /api/catalog-status/` shows how each header link resolved, how many blog/page answers are cached and whether any is failing, and the
same for reviews. It contains no address, secret, or customer data.

## 9. What to check first on staging

1. `/blog/` lists your posts; open one: title, date, picture, and (if you have one) a video look right. If posts appear with no picture or
   no category, check `https://<your-wordpress>/wp-json/wp/v2/posts?_embed=1&per_page=1` in a browser: it should list `_embedded` with
   `wp:featuredmedia` and `wp:term`. Some security or "disable REST API" plugins block the public REST API; the blog needs it.
2. `/our-story/` and `/contact/` show your pages (or "coming soon" if not yet written).
3. A product with approved reviews shows stars and reviews; `https://<your-shop>/wp-json/wc/store/v1/products/reviews?product_id=<id>` in a
   browser should list the same reviews. If it answers an error, WooCommerce's Store API is disabled or blocked.
4. The header's Game Cases link opens a page that includes Card Games products.
5. `/api/catalog-status/`: `nav` shows both categories resolved; `content.failing` and `reviews.failing` are 0.
6. Writing a review: follow [REVIEWS-STAGING-CHECKLIST.md](REVIEWS-STAGING-CHECKLIST.md). **Do not approve a test review**: your WooCommerce is
   the live one, and an approved review is public on the live product and counts in its rating.
