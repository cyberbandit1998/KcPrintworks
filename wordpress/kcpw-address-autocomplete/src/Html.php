<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/** Small helpers the administrator screens share. Every value goes through WordPress's own escaping on the way out. */
final class Html
{
    public static function h(string $text): string
    {
        return esc_html($text);
    }

    public static function a(string $text): string
    {
        return esc_attr($text);
    }

    public static function row(string $label, string $control, string $help = '', string $for = ''): string
    {
        $th = $for !== '' ? '<label for="' . self::a($for) . '">' . self::h($label) . '</label>' : self::h($label);
        return '<tr><th scope="row">' . $th . '</th><td>' . $control . ($help !== '' ? '<p class="description">' . self::h($help) . '</p>' : '') . '</td></tr>';
    }

    /** @param array<string, string> $options */
    public static function radios(string $name, string $current, array $options, string $legend = ''): string
    {
        $out = '<fieldset>' . ($legend !== '' ? '<legend class="screen-reader-text">' . self::h($legend) . '</legend>' : '');
        foreach ($options as $value => $label) {
            $out .= '<label class="kcpw-aa-radio"><input type="radio" name="' . self::a($name) . '" value="' . self::a((string) $value) . '"' . ((string) $value === $current ? ' checked' : '') . '> ' . self::h($label) . '</label><br>';
        }
        return $out . '</fieldset>';
    }

    /** @param array<string, string> $options */
    public static function select(string $name, string $id, string $current, array $options): string
    {
        $out = '<select name="' . self::a($name) . '" id="' . self::a($id) . '">';
        foreach ($options as $value => $label) {
            $out .= '<option value="' . self::a((string) $value) . '"' . ((string) $value === $current ? ' selected' : '') . '>' . self::h($label) . '</option>';
        }
        return $out . '</select>';
    }

    public static function number(string $name, string $id, int $value, int $min, int $max, int $step = 1): string
    {
        return '<input type="number" class="small-text" name="' . self::a($name) . '" id="' . self::a($id) . '" value="' . $value . '" min="' . $min . '" max="' . $max . '" step="' . $step . '">';
    }

    public static function text(string $name, string $id, string $value, string $class = 'regular-text', string $extra = ''): string
    {
        return '<input type="text" class="' . self::a($class) . '" name="' . self::a($name) . '" id="' . self::a($id) . '" value="' . self::a($value) . '" autocomplete="off"' . ($extra !== '' ? ' ' . $extra : '') . '>';
    }

    public static function checkbox(string $name, string $id, bool $checked, string $label): string
    {
        // The hidden 0 is what makes an unticked box reach the server as "off".
        return '<input type="hidden" name="' . self::a($name) . '" value="0"><label for="' . self::a($id) . '"><input type="checkbox" name="' . self::a($name) . '" id="' . self::a($id) . '" value="1"' . ($checked ? ' checked' : '') . '> ' . self::h($label) . '</label>';
    }

    /**
     * A one-button POST form to admin-post.php with its own nonce.
     *
     * @param array<string, string> $fields hidden fields besides action and nonce
     */
    public static function postForm(string $action, string $nonceAction, array $fields, string $label, string $class = 'button', string $attrs = ''): string
    {
        $out = '<form class="kcpw-aa-inline" method="post" action="' . self::a(admin_url('admin-post.php')) . '"' . ($attrs !== '' ? ' ' . $attrs : '') . '>';
        $out .= '<input type="hidden" name="action" value="' . self::a($action) . '">';
        foreach ($fields as $name => $value) {
            $out .= '<input type="hidden" name="' . self::a($name) . '" value="' . self::a($value) . '">';
        }
        $out .= wp_nonce_field($nonceAction, '_wpnonce', true, false);
        return $out . '<button type="submit" class="' . self::a($class) . '">' . self::h($label) . '</button></form>';
    }

    /** A notice built from the `kcpw_msg` query argument (a fixed list of messages, never text from the request). */
    public static function notice(): string
    {
        $msg = isset($_GET['kcpw_msg']) ? sanitize_key((string) wp_unslash($_GET['kcpw_msg'])) : '';
        $count = isset($_GET['kcpw_n']) ? (int) $_GET['kcpw_n'] : 0;
        $texts = [
            'saved' => ['success', __('Saved.', 'kcpw-address-autocomplete')],
            'error' => ['error', __('That did not work. Nothing was changed.', 'kcpw-address-autocomplete')],
            'needs_selector' => ['error', __('A set of fields needs at least the address field. Nothing was saved.', 'kcpw-address-autocomplete')],
            'bad_import' => ['error', __('That is not a file this plugin exported, so nothing was imported.', 'kcpw-address-autocomplete')],
            'imported' => ['success', sprintf(/* translators: %d: number of forms */ __('Imported %d form(s). They start as they were exported; check them, then turn them on.', 'kcpw-address-autocomplete'), $count)],
            'server_ok' => ['success', __('The server key works: Google answered a test address check.', 'kcpw-address-autocomplete')],
            'server_nokey' => ['error', __('Save a server key first (Settings > Features).', 'kcpw-address-autocomplete')],
            'server_auth' => ['error', __('Google rejected the server key. Check that it is typed in full and, if it is restricted by IP address, that your server\'s address is allowed.', 'kcpw-address-autocomplete')],
            'server_api' => ['error', __('The Address Validation API is not turned on for the key\'s project, or the key is restricted to other APIs or to websites. Turn it on in the API Library and allow it in the key\'s API restrictions; restrict a server key by IP address, not by website.', 'kcpw-address-autocomplete')],
            'server_quota' => ['error', __('Google says the quota is used up. Check the quota and billing in Google Cloud.', 'kcpw-address-autocomplete')],
            'server_network' => ['error', __('The request did not reach Google. Try again; if it repeats, check that your hosting allows your site to contact addressvalidation.googleapis.com.', 'kcpw-address-autocomplete')],
            'server_other' => ['error', __('Google returned an answer this screen does not recognise. Nothing was changed.', 'kcpw-address-autocomplete')],
            'wizard_done' => ['success', __('Setup finished. Open your checkout while logged in as an administrator to try it.', 'kcpw-address-autocomplete')],
        ];
        if (!isset($texts[$msg])) {
            return '';
        }
        [$type, $text] = $texts[$msg];
        return '<div class="notice notice-' . $type . ' is-dismissible"><p>' . self::h($text) . '</p></div>';
    }
}
