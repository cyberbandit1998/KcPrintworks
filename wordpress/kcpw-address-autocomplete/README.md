# KCPrintWorks Address Autocomplete

Version 0.1.0. A WordPress plugin that offers Google address suggestions in your address fields and fills street, city, state, postal code and
country for the customer. Built first for the **WooCommerce Checkout Block** (and the classic checkout), usable on any other form.

It starts in an **administrators-only preview**, loads **nothing** until a visitor clicks into an address field, and every extra feature is optional and off
by default. Full instructions (Google setup, install, preview first, going live, rollback, what is tested and what is not): [docs/ADDRESS-AUTOCOMPLETE.md](../../docs/ADDRESS-AUTOCOMPLETE.md).

## Settings in `wp-config.php` (optional)

| Constant | Meaning |
|---|---|
| `KCPW_AA_BROWSER_KEY` | The Google browser key. When set it is used instead of the one saved on the settings screen (which is then never saved back) |
| `KCPW_AA_SERVER_KEY` | The Google server key, for the optional address validation (later stage) |

## Development

```bash
php wordpress/kcpw-address-autocomplete/tests/run.php                 # PHP tests (WordPress stand-ins), no dependencies
php wordpress/kcpw-address-autocomplete/tests/fixture/build.php       # regenerate the JSON the browser tests read (the real output of the PHP)
node --test "scripts/address-autocomplete/*.test.mjs"                 # address mapping vectors, stylesheet rules and contrast, package contents
npm run build:address-autocomplete                                    # dist/kcpw-address-autocomplete.zip
npm run test:e2e                                                      # includes the plugin's browser specs (address-autocomplete-*.spec.ts)
```

`apps/storefront/tests/e2e/address-autocomplete-*.spec.ts` open **stand-in** pages (a plain form, a classic checkout, a Checkout Block written with real React)
with a **stand-in** for Google's script that records what it is asked. They prove the plugin's behavior, not Google's or WooCommerce's.
