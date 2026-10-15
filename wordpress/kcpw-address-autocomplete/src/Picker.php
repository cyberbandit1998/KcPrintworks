<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The Visual Selector Tool's two halves that need WordPress: (1) on the SITE, a page opened with `?kcpw_aa_pick=<token>` by a logged-in
 * administrator gets a small picking script (and the autocomplete script steps aside); (2) on the ADMIN screen that edits a form, the
 * list of pages to choose from and the one-time token.
 *
 * Safety: the picking script is added ONLY when the request carries a valid nonce for `kcpw_aa_pick` AND the user can manage options,
 * so no visitor, and no other website framing this site, can switch it on. It reads page markup and sends selector text to the
 * same-origin admin screen; it changes nothing and saves nothing.
 */
final class Picker
{
    public const NONCE_ACTION = 'kcpw_aa_pick';
    public const QUERY = 'kcpw_aa_pick';

    private static bool $active = false;

    public function __construct(private readonly string $file, private readonly string $version)
    {
    }

    public static function active(): bool
    {
        return self::$active;
    }

    /** For tests: a fresh request. */
    public static function reset(): void
    {
        self::$active = false;
    }

    public function register(): void
    {
        // Priority 1: before the autocomplete decides whether to load, so it can see that picking is on.
        add_action('wp', [$this, 'maybeActivate'], 1);
    }

    public function maybeActivate(): void
    {
        if (!isset($_GET[self::QUERY])) {
            return;
        }
        $token = sanitize_text_field((string) wp_unslash($_GET[self::QUERY]));
        if (!current_user_can('manage_options') || wp_verify_nonce($token, self::NONCE_ACTION) === false) {
            return;
        }
        self::$active = true;
        nocache_headers();
        add_filter('wp_robots', 'wp_robots_no_robots');
        add_action('wp_enqueue_scripts', [$this, 'enqueue']);
    }

    public function enqueue(): void
    {
        $base = plugin_dir_url($this->file);
        wp_enqueue_style('kcpw-aa-picker', $base . 'assets/css/kcpw-aa-picker.css', [], $this->version);
        wp_enqueue_script('kcpw-aa-picker', $base . 'assets/js/kcpw-aa-picker.js', [], $this->version, ['in_footer' => true]);
        $json = wp_json_encode(['strings' => self::pickerStrings()], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
        wp_add_inline_script('kcpw-aa-picker', 'window.KCPW_AA_PICKER=' . $json . ';', 'before');
    }

    /**
     * What the admin screen needs to run the tool.
     *
     * @return array{token: string, query: string, pages: list<array{label: string, url: string}>}
     */
    public static function adminData(): array
    {
        return ['token' => wp_create_nonce(self::NONCE_ACTION), 'query' => self::QUERY, 'pages' => self::pages()];
    }

    /**
     * Pages of THIS site an administrator can pick fields on: the home page, the WooCommerce pages and the published pages.
     *
     * @return list<array{label: string, url: string}>
     */
    public static function pages(): array
    {
        $pages = [['label' => __('Home page', 'kcpw-address-autocomplete'), 'url' => home_url('/')]];
        if (function_exists('wc_get_page_permalink')) {
            foreach (['checkout' => __('Checkout (add an item to your cart first)', 'kcpw-address-autocomplete'), 'cart' => __('Cart', 'kcpw-address-autocomplete'), 'myaccount' => __('My account', 'kcpw-address-autocomplete'), 'shop' => __('Shop', 'kcpw-address-autocomplete')] as $key => $label) {
                $url = (string) wc_get_page_permalink($key);
                if ($url !== '') {
                    $pages[] = ['label' => $label, 'url' => $url];
                }
            }
        }
        foreach ((array) get_pages(['number' => 80, 'post_status' => 'publish', 'sort_column' => 'post_title']) as $page) {
            if (is_object($page) && isset($page->post_title, $page->ID)) {
                $pages[] = ['label' => (string) $page->post_title, 'url' => (string) get_permalink((int) $page->ID)];
            }
        }
        // Only addresses on this very site: the tool reads the page, so it must be one that carries the plugin's script.
        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        $seen = [];
        $out = [];
        foreach ($pages as $page) {
            if ($page['url'] !== '' && wp_parse_url($page['url'], PHP_URL_HOST) === $host && !isset($seen[$page['url']])) {
                $seen[$page['url']] = true;
                $out[] = $page;
            }
        }
        return $out;
    }

    /** @return array<string, string> */
    public static function pickerStrings(): array
    {
        return [
            'bar' => __('Click the field you want, or press Tab to reach it and then Enter. Press Esc to cancel.', 'kcpw-address-autocomplete'),
            'noField' => __('That is not a field. Click a text box or a list.', 'kcpw-address-autocomplete'),
        ];
    }

    /** @return array<string, string> */
    public static function adminStrings(): array
    {
        return [
            'pick' => __('Pick', 'kcpw-address-autocomplete'),
            'pickTitle' => __('Pick a field', 'kcpw-address-autocomplete'),
            'pickFor' => __('Pick the field for: %s', 'kcpw-address-autocomplete'),
            'pickHelp' => __('Your page opens below. Click the field you want (or press Tab to reach it, then Enter). If the page needs something first, like an item in the cart for the checkout, do that in another tab of this browser, then reload.', 'kcpw-address-autocomplete'),
            'pickClose' => __('Close', 'kcpw-address-autocomplete'),
            'pickPage' => __('Page', 'kcpw-address-autocomplete'),
            'pickWindow' => __('Open in a new window', 'kcpw-address-autocomplete'),
            'pickWaiting' => __('Waiting for you to click a field…', 'kcpw-address-autocomplete'),
            'pickUse' => __('Use this selector', 'kcpw-address-autocomplete'),
            'pickUnique' => __('Unique: matches exactly one thing on the page. Best.', 'kcpw-address-autocomplete'),
            'pickMany' => __('Matches %d things on the page; the first is used. Prefer a unique one if you can.', 'kcpw-address-autocomplete'),
            'pickNone' => __('Matches nothing on this page (it may appear later).', 'kcpw-address-autocomplete'),
            'pickChosen' => __('Selector set.', 'kcpw-address-autocomplete'),
            'kind_id' => __('ID: most reliable', 'kcpw-address-autocomplete'),
            'kind_name' => __('Name', 'kcpw-address-autocomplete'),
            'kind_autocomplete' => __('Autocomplete attribute', 'kcpw-address-autocomplete'),
            'kind_data' => __('Data attribute', 'kcpw-address-autocomplete'),
            'kind_placeholder' => __('Placeholder text', 'kcpw-address-autocomplete'),
            'kind_class' => __('Class', 'kcpw-address-autocomplete'),
            'kind_path' => __('Full path: always works, but breaks if the page layout changes', 'kcpw-address-autocomplete'),
            'importFile' => __('Choose a file…', 'kcpw-address-autocomplete'),
        ];
    }
}
