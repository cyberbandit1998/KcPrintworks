# Address Autocomplete plugin (`wordpress/kcpw-address-autocomplete`)

A WordPress plugin that offers Google address suggestions in address fields and fills street, city, state, postal code and country for the
customer. It was built for the **WooCommerce Checkout Block** first (React-safe filling, so shipping rates and Stripe get the right address), and it
also works on the classic checkout, My Account addresses, Contact Form 7 / WPForms / Gravity Forms / Elementor / Fluent / Ninja / Formidable forms (presets) and any other
form (a shortcode, or the Visual Selector Tool). Version **0.1.0**. Package: `dist/kcpw-address-autocomplete.zip` (built by `npm run build:address-autocomplete`, also a CI artifact).

**Nothing has been installed or activated on the live WooCommerce site, and nothing was changed on the VPS, WordPress, Stripe or DNS.** This is a new plugin
that sits beside the existing `kcpw-core` and `kcpw-checkout-style` plugins; it does not depend on them (ADR-020).

> **Read this first: what is proven and what is not.** Everything below was built and tested here against **stand-ins**: a stand-in for Google's script, stand-in
> WordPress functions, and stand-in pages (a plain form, a classic checkout, and a Checkout Block written with real React). This sandbox cannot reach Google,
> `kcprintworks.com`, wordpress.org or Stripe. So a real Google project and key, a real WordPress and WooCommerce (and which version of the Checkout Block),
> and a real Stripe payment are **unverified** until you do the staging steps in section 4. That is why the plugin starts in an administrators-only Preview and why every extra
> feature is off.

## 1. What you get, against your list

You asked for the useful Free and Pro features of a commercial address-autocomplete plugin, **without a paid licence and without copying anyone's code, branding or assets**. All of
this is original code under GPL-2.0-or-later. Where your list names a feature, this is what happened to it:

| Your list | Here |
|---|---|
| Works with any form, by CSS selector, unlimited configurations | **Built.** Any number of "forms" (up to 25), each with groups of fields, per-form countries / language / place type / pages |
| Visual Selector Tool (click a field instead of writing CSS) | **Built.** Forms > Add or edit > the **Pick** button beside a field opens your own page in a "Pick a field" window; you click the field, it suggests a selector and tells you whether it is unique (admin-only, one-time token, never loads for customers) |
| Single-line mode | **Built** (per form: fill the one line with the full address) |
| Dropdown with keyboard navigation, spinner, "no results", Google attribution | **Built.** ARIA combobox; arrow keys, Enter, Esc, Tab; screen-reader announcements; "Powered by Google" cannot be switched off |
| Places API (New), session tokens, debounce | **Built.** One session token per typing session, 300 ms pause, 3 characters, in-memory cache, a request cap, stop after failure (section 6) |
| Shortcode | **Built.** `[kcpw_address_autocomplete label="Home address" name="home" fields="hidden\|visible\|none" required="yes"]` |
| Duplicate / import / export configurations | **Built** (JSON; an import re-validates every value and never overwrites an existing form) |
| Health check, conflict detection | **Built.** "Test my key" tests the script, key, Places API (New) and Geocoding API; another plugin loading Google Maps on the same page is detected and shown |
| Presets for 8 form plugins | **Built, with one honest caveat.** WooCommerce Block and WooCommerce classic selectors are the real ones; the selectors for Contact Form 7, WPForms, Gravity Forms, Elementor, Fluent, Ninja and Formidable are written from their documented markup and are **unverified** here (none of those plugins is installed). Use the Visual Selector Tool to confirm them on your own form |
| Smart (country-aware) field mapping | **Built.** US/CA/GB/AU/DE and many others; UK post town and county, NYC boroughs, number-after-street countries, units; the shared test vectors cover them |
| WooCommerce auto-setup | **Built as a preset + the setup wizard** (it adds the checkout form for you; it does not touch WooCommerce settings) |
| Map picker | **Built, optional** ("Choose on a map") |
| GPS | **Built, optional** ("Use my location"; only on a click) |
| Address validation (badges) | **Built, optional** ("looks right" / "please double-check"; advice only; server key) |
| PO box detection | **Built, optional** (warn, or refuse PO boxes at checkout in Live mode only) |
| Multi-country restriction | **Built** (up to 5 countries, global or per form) |
| Per-form language, per-page activation | **Built** |
| Verification webhook | **Built, optional, opt-in, off.** Needs consent + an https address; no address included unless you tick a separate box |
| Checkout abandonment tracking | **Built as a rough count only, opt-in, off.** Two numbers (checkouts started, orders finished); nothing about any person (section 7) |
| IP-based geolocation | **Built, opt-in, off.** A country from your CDN's header (no outside call) or an IP lookup service you name; it only softens the ranking |
| Usage analytics | **Built.** Whole-number counters on the Dashboard; never an address or what anyone typed |
| Dark mode, RTL, ARIA, dropdown styling | **Built** (light / dark / match / follow-device; accent colour and roundness; RTL pages tested; WCAG 2.2 AA scans) |
| REST API | **Built only as far as it is needed**: four small routes for this plugin's own pages (section 8). **No public autocomplete proxy** (it would let strangers spend your Google quota) |
| Administrator-only preview | **Built, and it is the default.** Mode: Off / **Preview** / Live |
| Setup wizard | **Built** (3 steps: key, form, start safely) |
| **Deliberately not built** | White label (nothing to white-label: this is your own plugin); Elementor widget / form field (the Elementor *preset* and the shortcode cover it); saved addresses (stores customer addresses, which you asked to avoid); WhatsApp / Telegram support links (a commercial plugin's support channel, not a feature) |

## 2. The safe order (what to do, and in what order)

The plugin is built so that you can prove each layer before adding the next, and so that a mistake in any layer cannot stop an order.

| Stage | What | Who sees it | Risk to checkout |
|---|---|---|---|
| **0** | Install on **staging** (a copy of the shop), Preview mode, your Google key | You, logged in as administrator | None to customers (they get nothing) |
| **1** | Checkout Block (and classic) suggestions + filling, tested on staging with a real Stripe **test** payment | Administrators | None to customers |
| **2** | Go Live for the checkout page only | Customers | Low: the address fields are plain fields whenever anything fails |
| **3a** | PO box notice (needs no Google service) | as above | Low (advice only) |
| **3b** | Address check (needs a server key) | | Low (advice only; never blocks) |
| **3c** | "Use my location" / "Choose on a map" | | Low (only on a click) |
| **3d** | Opt-ins (webhook, checkout count, location hint) | | Privacy change: read section 7 first |
| **3e** | "Refuse PO boxes" | | **The only feature that can refuse an order.** Staging only until you have seen it work on a real checkout |

Switch **one thing at a time**, in Preview, and place a test order between each. You can turn any feature off again in one click; the checkout then behaves exactly as before.

## 3. Google setup: APIs, keys, billing

Google Maps Platform needs a Google Cloud project **with billing turned on**, even when your usage stays inside Google's free monthly allowance. Prices and allowances change: read
[Google's current pricing](https://mapsplatform.google.com/pricing/) before you go live; this document does not quote any, on purpose.

**Which APIs, by feature** (turn each on in the [API Library](https://console.cloud.google.com/apis/library)):

| Feature | APIs to enable |
|---|---|
| Address suggestions (always) | **Maps JavaScript API** and **Places API (New)** |
| "Use my location" | **Geocoding API** (the position is turned into an address by Google, in the visitor's browser) |
| "Choose on a map" | **Maps JavaScript API** (a map load is billed) and **Geocoding API**; a **Map ID** (free; "DEMO_MAP_ID" works only for testing) |
| Address check | **Address Validation API**, called from **your server** with a second key |

**Two keys, not one:**

1. **Browser key** (Settings > General, or `KCPW_AA_BROWSER_KEY` in `wp-config.php`). It is visible to visitors by design. In Google Cloud > Credentials: *Application restrictions* = **Websites** and add
   your shop address (for example `https://shop.kcprintworks.com/*`); *API restrictions* = only the APIs above (Maps JavaScript, Places (New), Geocoding). The restrictions are what stop others using it.
2. **Server key** (Settings > Features, or `KCPW_AA_SERVER_KEY`), only if you use the address check. Restrict it by **IP address** (your server's), never by website, and to the **Address Validation API** only. It is never sent to a browser, never printed in a page, and never shown back on the settings screen (only its last four characters).

**Limits that cannot be bypassed:** in Google Cloud set a **budget alert** and a **daily quota** on Places (and Address Validation if used). The plugin's own pauses (request cap, daily check limit) are a courtesy, not a substitute.

**Google's terms.** The suggestions list shows "Powered by Google" (there is deliberately no setting to hide it; Google requires it when suggestions are not shown on a Google map). The map window is a real Google map with Google's own
attribution. The plugin does not show Geocoding results on a non-Google map. It caches nothing from Google except, optionally, its own three-way address-check verdict for up to a day (set `define('KCPW_AA_VALIDATION_CACHE_SECONDS', 0);` in `wp-config.php` to remember nothing).
Read [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms) yourself: this document is not legal advice, and Google can change its terms.

## 4. Install and test (nothing on the live site)

1. Build or download the package: `npm run build:address-autocomplete` produces `dist/kcpw-address-autocomplete.zip` (CI attaches the same file to every run).
2. **On staging, not on the live shop:** Plugins > Add New > Upload Plugin > choose the ZIP > Install > **Activate**. Activating changes nothing for visitors: the plugin starts in **Preview** with no key.
3. Open **Address Autocomplete > Dashboard**, press **Run the 3-step setup**: (1) paste the browser key, (2) add the WooCommerce Checkout Block form, (3) leave **Preview** selected.
4. Dashboard > **Test my key**. It must show Working for the script, Places API (New), and (only if you use those features) Geocoding. A failure explains itself in plain words (key rejected, API not enabled, quota, billing, blocked script).
5. **Preview test, logged in as an administrator** (customers see nothing): open the checkout with an item in the cart and check each of these:
   - [ ] Typing 3+ characters in the shipping street field shows suggestions, with "Powered by Google".
   - [ ] Choosing one fills street, city, state, postal code **and country** (try a US address, a Canadian one, and a UK one).
   - [ ] The **shipping rates update** after choosing (the cart totals recalculate for the new address).
   - [ ] Leave "Use same address for billing" on, then off: the billing fields work the same way.
   - [ ] Place a test order with Stripe in **test mode** (card `4242 4242 4242 4242`): the order's shipping and billing address are the filled ones, not the typed text.
   - [ ] Unplug the key (blank it) or block `maps.googleapis.com`: the fields are still ordinary text fields and the order still goes through; customers see no error.
   - [ ] Keyboard only: type, Arrow Down, Enter fills the form and does not place the order; Esc closes the list.
   - [ ] On a phone (or a narrow browser): the list fits, rows are tappable.
6. Only after all of that on staging: install on the live shop the same way, **leave it in Preview**, repeat the checklist once as administrator, and only then choose **Go live**. (Installing on the live shop is a change to the live site: do it when you are ready; this repository does not do it for you.)
7. Add the optional features one at a time (section 2, Stage 3), in Preview, with a test order between each.

**Rollback:** Dashboard > **Turn off** (nothing loads for anyone), or deactivate the plugin (the site is exactly as before), or delete it (Plugins > Delete removes its settings, key, form list, counters and temporary markers; nothing else on the site is touched).

## 5. Checkout Block compatibility (the first priority)

The Checkout Block is a React application: setting `input.value = ...` is ignored by React, and writing several fields at once can lose some. The plugin therefore:

- writes **one field at a time** with the browser's own value setter followed by real `input` and `change` events, which is what React listens for, and waits for the page to settle between the country and the state (the country re-draws the state field);
- fills in the order **country, state, postal code, city, street**, reads each back, and writes again where React kept an older value;
- opens the hidden "Add apartment, suite, etc." field itself when there is a unit (inside **its own** address form: shipping and billing are separate);
- picks `<select>` options by code, then name (accents, case and words such as "County" ignored), and drives the block's autocomplete-style combobox when a country or state is drawn as one;
- finds the fields again after React re-draws them (a MutationObserver), so changing the country, or switching "same address for billing", never leaves the plugin attached to a field that no longer exists;
- **never touches the payment area**: no selector reaches it, and a browser test fails if a single mutation or event lands on the payment stand-in;
- on the classic checkout also triggers WooCommerce's own `update_checkout` so shipping is recalculated.

What this proves, and what it does not: the browser tests run **real React** (React 19) in a Checkout Block *stand-in* that imitates the block's controlled inputs, its country/state redraw, its hidden second address line, its store of
shipping and billing addresses, and a shipping-rates calculation that reads that store. They show the store ends up holding the filled address. They are **not** WooCommerce's actual Checkout Block. WooCommerce changes the block's markup between releases; the
selectors (`#shipping-address_1` and the others) are the ones the block uses today, and the **Pick** button on the form editor lets you re-point them without code if a release changes them. Which WooCommerce version you run is **unknown** here.

## 6. How it keeps Google costs down

- Google is contacted **only when a visitor first clicks into an address field**, never when a page loads. A page with no matching form downloads nothing at all.
- A request needs **3 characters** and a **300 ms pause** (both adjustable); the same text is answered from memory.
- **One session token** covers a whole typing session; after a choice the plugin asks only for the address parts (address components, formatted address, location) and starts a fresh session.
- At most **12 requests per typing session** (adjustable), then it says so and the customer types. After a failure (bad key, API off, quota, blocked script, timeout) it **stops asking on that page**.
- The address check has a **daily ceiling** (default 200) and answers repeats from memory.
- The map allows **10 lookups per opening**; GPS asks once per button press.
- Dashboard > **API usage** shows the counts (estimated; Google's own report is the authority for the bill).

## 7. Privacy, opt-ins and what leaves the site

**By default the plugin sends no address, no name and no visitor detail to anyone except Google, and only the text the visitor is typing into the address field (for the suggestions they asked for).**
Nothing about customers is stored.

| Thing | Goes to | When | Stored |
|---|---|---|---|
| The text typed in the address field, a session token | Google (Places API) | While typing in an address field | Not by this plugin |
| The chosen suggestion's id | Google (Places API) | On choosing | No |
| The visitor's GPS position | Google (Geocoding), from their browser | Only when they press "Use my location" and allow it | Kept in memory on that page only |
| A pin position | Google (Geocoding), from their browser | Only inside the map window | No |
| The address parts (no name, email, phone) | Your server, then Google (Address Validation) | After an address is filled in or edited, **only if the address check is on** | A 3-way verdict + reason for up to a day, under a hash (switchable off); nothing else |
| Counters (requests, choices, failures; whole numbers) | Your server | On leaving the page, **only if usage counters are on** (default on) | Whole numbers per day, 60 days |
| "Checkout started" / "order finished" counts | Your server | **Opt-in, off** | Two numbers per day; a 30-day marker keyed by the order number so a refreshed thank-you page does not count twice |
| A short message about a problem (no address by default) | The https address you choose | **Opt-in, off, needs consent** | No |
| The visitor's country (and with a lookup service, their IP address, rounded position) | Your CDN header (no call) or the lookup service you name | **Opt-in, off** | A one-way hash of the IP for 6 hours, so a returning visitor is not looked up again |

Rules the code enforces (each has a test, and each was checked by deliberately breaking it and watching a test fail):

- The usage beacon accepts **whole numbers from a fixed list only**: a field named `address`, a string or an unknown key is discarded. The browser **cannot** report address checks or checkouts: the server counts those itself.
- The **webhook** is off until you switch it on, tick the consent box, and give an **https** address with no credentials in it. By default a message says only that a check found a problem, which kind, your site and the form: **no address**. The address is added
  only if you tick a *separate* box that says customer data will leave your site. It is sent once, without waiting, and the same address does not ring twice in an hour; a broken receiver never reaches the customer. Addresses an administrator types in are only called through WordPress's "safe" HTTP functions, which refuse your server's own network.
- **Checkout counting** is two numbers. It does not follow anyone, set a cookie or store an address; it counts only while the plugin is Live.
- **Location hint** only ever softens the ranking of suggestions (Google's `region` and a location bias); it never restricts them, never fills a field, and a form that restricts countries ignores it. Using a lookup service shares visitors' IP addresses with a third party: **check your privacy notice says so**.
- Every one of these is a separate switch on **Settings > Privacy and opt-ins**, shown with its current state.

This is a technical description, not legal advice. If you sell to the EU or UK, check that your privacy notice names Google as a processor for the suggestions and, if you switch them on, the lookup service and the webhook receiver.

## 8. The optional features, one by one

- **PO box notice** (Settings > Features). Reads the street lines as they are typed or filled in and shows "This looks like a PO box. Please check that we can deliver to it." (or the military sentence). Needs no Google service.
  The rules are written twice (PHP and JavaScript) and tested against the **same list of 42 addresses** so they cannot drift. It is a warning aid: addresses can be written in ways no list foresees. *Refuse PO boxes* is enforced by your **server** when the order is placed (classic checkout via
  `woocommerce_after_checkout_validation`; the Checkout Block via the Store API's `woocommerce_store_api_checkout_update_order_from_request` with WooCommerce's `RouteException`), **only while the plugin is Live**, **only for PO boxes** (never APO/FPO military addresses), and any error inside the check lets the order through.
  *This enforcement has been run against stand-ins only.* Test it on staging with a real checkout before using it on the live shop.
- **Address check.** After an address is filled in or edited (and a field is left), the page asks **your server**, which asks Google's Address Validation API with the server key (in a header, never in an address) and answers one of: **ok** ("This address looks right."), **check** ("Please double-check this address."), **bad** ("We could not verify this address. Please check it.") or **unknown** (says nothing).
  It never blocks typing, the Place Order button or payment. A page makes at most 6 checks; each visitor 10 a minute; the shop at most the daily ceiling. Settings > Features > **Test the server key** makes one real, billed check and explains any failure.
- **Use my location.** A button under the street field. Pressing it asks the browser for permission; the position goes from the visitor's browser to Google's Geocoding service and back as an address. A result that names only a town is not used. Refusing permission is answered kindly and nothing else happens.
- **Choose on a map.** A button that opens a window with a Google map and a pin: click or tap, drag the pin, or use the four "Move pin" buttons (so it works without a mouse; Esc closes it and focus returns to the button). Each place the pin lands asks Google once what address is there; "Use this address" fills the form like a suggestion.
- **Visitor tools** are drawn as two plain text buttons; the code behind each is fetched only when pressed (or pointed at).
- **WooCommerce hooks** (`src/WooCommerce.php`) are the only server-side reads of WooCommerce: PO box refusal (above) and the optional finished-order count. Nothing is written to an order, a customer or a product.
- **Routes** (`/wp-json/kcpw-aa/v1/`): `usage` (always; does nothing when counters are off), `validate` (only when the address check is on **and** a server key is saved), `hint` (only when the location hint is on), `checkout-start` (only when checkout counting is on). Each accepts this site's own pages only,
  is rate-limited, reads nothing of the site's, and in Preview answers only a signed-in administrator (the page gives an administrator the REST nonce; a customer's page never holds one). With no feature on, **one** route exists.
  *What protects a public route, honestly:* the "this site's own pages only" check looks at the browser's `Origin` header, which stops other websites' pages but **not** a script someone runs themselves; the real limits are the per-visitor rate limit, the daily ceiling and your Google-side quota and budget alert. In Live mode these routes are public by design (customers are not logged in).
  *Behind a proxy or CDN:* the rate limit and the IP lookup use the address WordPress sees (`REMOTE_ADDR`). If your site sits behind a reverse proxy (Nginx Proxy Manager, Cloudflare) and WordPress is not set up to see the real visitor address, every visitor shares one allowance and the lookup service is asked about your proxy, not the visitor. Check this on staging before using the address check or the IP lookup in Live.

## 9. Settings in `wp-config.php` (optional)

| Constant | Meaning |
|---|---|
| `KCPW_AA_BROWSER_KEY` | The browser key. Used instead of the saved one and never saved back |
| `KCPW_AA_SERVER_KEY` | The server key (address check). Same rules |
| `KCPW_AA_VALIDATION_CACHE_SECONDS` | How long an address-check verdict is remembered, 0 to 86400 (0 = never) |

## 10. Tests and results

Run from the repository root (the same commands CI runs):

| Command | What it covers |
|---|---|
| `php wordpress/kcpw-address-autocomplete/tests/run.php` | **180 PHP tests** (stand-in WordPress): settings clamping and opt-in rules, forms, page matching, usage counters and rate limiter, the front-end gates, the REST routes (gates, caching, ceilings, webhook, hint, counters), WooCommerce hooks, admin screens and handlers (nonce, capability, escaping), the Visual Selector Tool's token, the shortcode, address validation, PO box vectors, a check that the pure classes call no WordPress function and that the committed browser fixtures equal what the PHP prints |
| `node --test "scripts/address-autocomplete/*.test.mjs"` | Address-mapping vectors, the PO box vectors against the JavaScript, stylesheet scoping and WCAG contrast (list, notes, buttons, map window), package contents, download budgets |
| `npm run test:e2e` (the `address-autocomplete-*.spec.ts` files) | Real Chromium: desktop and phone; keyboard and screen-reader announcements; axe WCAG 2.2 AA scans in light, dark and right-to-left; the Checkout Block stand-in with real React (fields, shipping rates from the store, same-address toggle, payment area untouched); classic checkout; Google failures (blocked script, rejected key, API off, quota used up, unknown errors, a request that takes too long, an older Google script loaded by another plugin, no results, address details failing, hostile text from Google); the Visual Selector Tool; the shortcode; every admin screen; every optional feature (PO box, address check, GPS, map, hint, count) including its failure paths |

**Mutation checks.** For each rule that protects money, privacy or checkout, the code was deliberately broken and the tests had to fail. Broken and caught: the preview gate, the same-site check, the daily ceiling, the verdict cache, the webhook sending without opt-in or always including the address,
the server key left out or put in the URL, PO box refusal in Preview, blocking military addresses, double-counting orders, unrounded coordinates, private IPs sent to a lookup service, the nonce given to customers, a webhook switched on without consent, every PO box phrase one by one, the checkout count sent on every focus, optional code downloaded eagerly, the map and address-check ceilings, the hint overriding a country restriction, and more. One phrase ("postbus") survived the first round, which showed a missing test case; it was added.

**Not proven here** (needs the staging steps in section 4): a real Google project, key, restrictions and billing; a real WordPress and WooCommerce (version unknown) and the real Checkout Block's markup; a real Stripe payment; the selectors of the seven non-WooCommerce form plugins; PO box refusal on a real checkout;
real browsers other than Chromium (Safari and Firefox behave differently around `<dialog>`, geolocation and autofill); screen readers (the ARIA pattern is the standard combobox, and axe passes, but no human listened).

## 11. Troubleshooting

| You see | Likely cause | Do this |
|---|---|---|
| Dashboard > Test my key: "Google rejected the key" | Key typed in part, or its website restriction does not include this address | Re-paste the key; add `https://yourshop.com/*` to the key's website restrictions |
| "API not turned on" | Places API (New) is off for the key's project, or the key's API restrictions leave it out | Enable it; add it to the key's API restrictions |
| A red pill at the bottom of your page (administrators only) | The reason suggestions stopped; customers see only "enter your address yourself" | Follow the pill's code with the table above |
| "Another plugin loads Google Maps" on the Dashboard | Two copies of the Maps script on one page | Ask that plugin to use the current script or switch its map off on the checkout |
| Suggestions work but a field is not filled | The selector no longer matches (a WooCommerce update changed the markup) | Forms > edit > the **Pick** button |
| Nothing appears on the checkout for a customer | Mode is Preview or Off | Dashboard > Go live (after testing) |
| The address check says nothing | Unknown answer: server key missing or wrong, API off, daily ceiling reached, or Google unreachable | Settings > Features > Test the server key; Dashboard > "Problems seen" |

## 12. Where things are

```
wordpress/kcpw-address-autocomplete/
  kcpw-address-autocomplete.php     bootstrap (PHP 8.1+, WordPress 6.4+; declares compatibility with the Cart/Checkout blocks and order-storage tables)
  uninstall.php                     removes settings, key, forms, counters and temporary markers
  src/                              pure decision classes (no WordPress calls; a test enforces it) + thin WordPress layers (Frontend, Rest, WooCommerce, Admin*, Wizard, Picker, WpHttp)
  assets/js/kcpw-aa.js              core (about 17.8 KB gzipped)
  assets/js/kcpw-aa-{pobox,validate,gps,map}.js     optional features, each a separate small file loaded only when needed
  assets/js/kcpw-aa-{admin,picker}.js, assets/css/   settings screens and the Visual Selector Tool (never loaded for customers)
  tests/                            PHP tests, shared vectors, fixtures, the Google and page stand-ins
scripts/address-autocomplete/       Node tests (mapping, PO box, stylesheet, package)
apps/storefront/tests/e2e/address-autocomplete-*.spec.ts, tests/support/aa.ts     browser tests
```
