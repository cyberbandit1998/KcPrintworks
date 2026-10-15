<?php
declare(strict_types=1);

namespace KcPrintworks\AddressAutocomplete;

/**
 * The Forms screen: the list (turn on/off, edit, duplicate, delete), the editor (where suggestions appear and which fields to fill,
 * with the Visual Selector Tool's "Pick" buttons), and import/export of the list as a JSON file.
 *
 * Same rules as {@see Admin}: capability `manage_options`, a nonce per action, everything saved goes through {@see FormConfig}.
 */
class AdminForms
{
    public const CAPABILITY = 'manage_options';

    public function __construct(private readonly Store $store)
    {
    }

    public function register(): void
    {
        add_action('admin_post_kcpw_aa_forms', [$this, 'onForms']);
        add_action('admin_post_kcpw_aa_form_save', [$this, 'onFormSave']);
        add_action('admin_post_kcpw_aa_export', [$this, 'onExport']);
        add_action('admin_post_kcpw_aa_import', [$this, 'onImport']);
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Screens
    // ------------------------------------------------------------------------------------------------------------------

    public function screenHtml(): string
    {
        $edit = isset($_GET['edit']) ? sanitize_key((string) wp_unslash($_GET['edit'])) : '';
        $new = isset($_GET['new']) ? sanitize_key((string) wp_unslash($_GET['new'])) : '';
        if ($edit !== '') {
            $form = $this->store->form($edit);
            if ($form !== null) {
                return $this->editorHtml($form, false);
            }
        }
        if ($new !== '' && isset(Presets::all()[$new])) {
            return $this->editorHtml(FormConfig::blank($new), true);
        }
        return $this->listHtml();
    }

    public function listHtml(): string
    {
        $out = '<div class="wrap kcpw-aa-admin"><h1>' . Html::h(__('Address forms', 'kcpw-address-autocomplete')) . '</h1>' . Html::notice();
        $out .= '<p>' . Html::h(__('A "form" says where suggestions appear and which fields get filled. Start with your WooCommerce checkout.', 'kcpw-address-autocomplete')) . '</p>';
        if ($this->store->forms === []) {
            $out .= '<p><em>' . Html::h(__('No forms yet.', 'kcpw-address-autocomplete')) . '</em></p>';
        } else {
            $out .= '<div class="kcpw-aa-scroll" role="region" tabindex="0" aria-label="' . Html::a(__('Your forms', 'kcpw-address-autocomplete')) . '"><table class="widefat striped"><thead><tr><th scope="col">' . Html::h(__('Name', 'kcpw-address-autocomplete')) . '</th><th scope="col">' . Html::h(__('Where', 'kcpw-address-autocomplete')) . '</th><th scope="col">' . Html::h(__('Status', 'kcpw-address-autocomplete')) . '</th><th scope="col">' . Html::h(__('Actions', 'kcpw-address-autocomplete')) . '</th></tr></thead><tbody>';
            foreach ($this->store->forms as $form) {
                $on = ($form['enabled'] ?? false) === true;
                $id = (string) $form['id'];
                $out .= '<tr><th scope="row">' . Html::h((string) $form['name']) . '</th><td>' . Html::h(self::whereText($form)) . '</td><td>' . Html::h($on ? __('On', 'kcpw-address-autocomplete') : __('Off', 'kcpw-address-autocomplete')) . '</td><td class="kcpw-aa-row-actions">';
                $out .= '<a class="button button-small" href="' . Html::a(admin_url('admin.php?page=kcpw-aa-forms&edit=' . $id)) . '">' . Html::h(__('Edit', 'kcpw-address-autocomplete')) . '</a> ';
                $out .= Html::postForm('kcpw_aa_forms', 'kcpw_aa_forms', ['do' => 'toggle', 'id' => $id], $on ? __('Turn off', 'kcpw-address-autocomplete') : __('Turn on', 'kcpw-address-autocomplete'), 'button button-small') . ' ';
                $out .= Html::postForm('kcpw_aa_forms', 'kcpw_aa_forms', ['do' => 'duplicate', 'id' => $id], __('Duplicate', 'kcpw-address-autocomplete'), 'button button-small') . ' ';
                $out .= Html::postForm('kcpw_aa_forms', 'kcpw_aa_forms', ['do' => 'delete', 'id' => $id], __('Delete', 'kcpw-address-autocomplete'), 'button button-small button-link-delete', 'data-confirm="' . Html::a(__('Delete this form?', 'kcpw-address-autocomplete')) . '"');
                $out .= '</td></tr>';
            }
            $out .= '</tbody></table></div>';
        }

        $out .= '<h2>' . Html::h(__('Add a form', 'kcpw-address-autocomplete')) . '</h2><ul class="kcpw-aa-presets">';
        foreach (Presets::all() as $key => $preset) {
            $out .= '<li><strong>' . Html::h($preset['label']) . '</strong><br><span>' . Html::h($preset['help']) . '</span> ';
            $out .= $key === 'custom'
                ? '<a class="button" href="' . Html::a(admin_url('admin.php?page=kcpw-aa-forms&new=custom')) . '">' . Html::h(__('Set up', 'kcpw-address-autocomplete')) . '</a>'
                : Html::postForm('kcpw_aa_forms', 'kcpw_aa_forms', ['do' => 'add_preset', 'preset' => $key], __('Add', 'kcpw-address-autocomplete'), 'button');
            $out .= '</li>';
        }
        $out .= '</ul>';

        $out .= '<h2>' . Html::h(__('Back up or move your forms', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . Html::h(__('The file holds selectors and switches only: never a Google key.', 'kcpw-address-autocomplete')) . '</p>';
        $out .= '<p><a class="button" href="' . Html::a(self::exportUrl()) . '">' . Html::h(__('Download my forms (JSON)', 'kcpw-address-autocomplete')) . '</a></p>';
        $out .= '<form method="post" action="' . Html::a(admin_url('admin-post.php')) . '" class="kcpw-aa-import">';
        $out .= '<input type="hidden" name="action" value="kcpw_aa_import">' . wp_nonce_field('kcpw_aa_import', '_wpnonce', true, false);
        $out .= '<p><label for="kcpw-aa-import-file">' . Html::h(__('Choose an exported file', 'kcpw-address-autocomplete')) . '</label><br><input type="file" id="kcpw-aa-import-file" accept=".json,application/json"></p>';
        $out .= '<p><label for="kcpw-aa-import-json">' . Html::h(__('Or paste its contents', 'kcpw-address-autocomplete')) . '</label><br><textarea name="json" id="kcpw-aa-import-json" rows="5" class="large-text code"></textarea></p>';
        $out .= '<p><button type="submit" class="button">' . Html::h(__('Import', 'kcpw-address-autocomplete')) . '</button></p></form>';
        return $out . '</div>';
    }

    /**
     * @param array<string, mixed> $form
     */
    public function editorHtml(array $form, bool $isNew): string
    {
        $title = $isNew ? __('Add a form', 'kcpw-address-autocomplete') : __('Edit form', 'kcpw-address-autocomplete');
        $out = '<div class="wrap kcpw-aa-admin"><h1>' . Html::h($title) . '</h1>' . Html::notice();
        $out .= '<p><a href="' . Html::a(admin_url('admin.php?page=kcpw-aa-forms')) . '">&larr; ' . Html::h(__('All forms', 'kcpw-address-autocomplete')) . '</a></p>';
        $out .= '<form method="post" action="' . Html::a(admin_url('admin-post.php')) . '" class="kcpw-aa-editor">';
        $out .= '<input type="hidden" name="action" value="kcpw_aa_form_save">' . wp_nonce_field('kcpw_aa_form_save', '_wpnonce', true, false);
        $out .= '<input type="hidden" name="id" value="' . Html::a($isNew ? '' : (string) $form['id']) . '"><input type="hidden" name="preset" value="' . Html::a((string) $form['preset']) . '">';

        $out .= '<table class="form-table" role="presentation"><tbody>';
        $out .= Html::row(__('Name', 'kcpw-address-autocomplete'), Html::text('f[name]', 'kcpw-aa-f-name', (string) $form['name'], 'regular-text', 'maxlength="80"'), '', 'kcpw-aa-f-name');
        $out .= Html::row(__('Status', 'kcpw-address-autocomplete'), Html::checkbox('f[enabled]', 'kcpw-aa-f-enabled', ($form['enabled'] ?? false) === true, __('On (suggestions appear on this form when the plugin is in Preview or Live mode)', 'kcpw-address-autocomplete')));
        $out .= Html::row(__('What to fill', 'kcpw-address-autocomplete'), Html::radios('f[mode]', (string) $form['mode'], [
            'smart' => __('Street, city, state, postal code and country, each into its own field (recommended)', 'kcpw-address-autocomplete'),
            'single' => __('The whole address in the one field the customer types in', 'kcpw-address-autocomplete'),
        ], __('What to fill', 'kcpw-address-autocomplete')));
        $out .= '</tbody></table>';

        $out .= '<h2>' . Html::h(__('Fields', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<p>' . Html::h(__('Each set of fields is one address on the page (a checkout has a shipping and a billing address). Type a selector, or press Pick and click the field on your own page. Only the address field is required; leave the others empty if the form does not have them. To remove a set, empty its address field.', 'kcpw-address-autocomplete')) . '</p>';
        $groups = $form['groups'];
        // One spare, empty set so a new address can be added without any script.
        if (count($groups) < FormConfig::MAX_GROUPS) {
            $groups[] = ['label' => '', 'scope' => '', 'fields' => array_fill_keys(Presets::FIELDS, '')];
        }
        $labels = [
            'address' => __('Address (the field the customer types in)', 'kcpw-address-autocomplete'),
            'address2' => __('Apartment, suite (optional)', 'kcpw-address-autocomplete'),
            'city' => __('City', 'kcpw-address-autocomplete'),
            'state' => __('State or province', 'kcpw-address-autocomplete'),
            'postcode' => __('Postal code', 'kcpw-address-autocomplete'),
            'country' => __('Country', 'kcpw-address-autocomplete'),
        ];
        foreach ($groups as $i => $group) {
            $out .= '<fieldset class="kcpw-aa-group"><legend>' . Html::h(sprintf(__('Set %d', 'kcpw-address-autocomplete'), $i + 1)) . '</legend>';
            $out .= '<p><label for="kcpw-aa-g' . $i . '-label">' . Html::h(__('Label (only for you)', 'kcpw-address-autocomplete')) . '</label> ' . Html::text("f[groups][$i][label]", "kcpw-aa-g$i-label", (string) $group['label'], 'regular-text', 'maxlength="60"') . '</p>';
            foreach (Presets::FIELDS as $field) {
                $id = "kcpw-aa-g$i-$field";
                $out .= '<p class="kcpw-aa-field-row"><label for="' . $id . '">' . Html::h($labels[$field]) . '</label><br>';
                $out .= Html::text("f[groups][$i][fields][$field]", $id, (string) ($group['fields'][$field] ?? ''), 'regular-text code', 'maxlength="300" spellcheck="false"');
                $out .= ' <button type="button" class="button kcpw-aa-pick" data-target="' . $id . '" data-label="' . Html::a($labels[$field]) . '">' . Html::h(__('Pick', 'kcpw-address-autocomplete')) . '</button></p>';
            }
            $out .= '<p><label for="kcpw-aa-g' . $i . '-scope">' . Html::h(__('Only inside this area (optional selector)', 'kcpw-address-autocomplete')) . '</label><br>' . Html::text("f[groups][$i][scope]", "kcpw-aa-g$i-scope", (string) $group['scope'], 'regular-text code', 'maxlength="300" spellcheck="false"') . '</p>';
            $out .= '</fieldset>';
        }

        $out .= '<h2>' . Html::h(__('Where it appears', 'kcpw-address-autocomplete')) . '</h2><table class="form-table" role="presentation"><tbody>';
        $pages = $form['pages'];
        $out .= Html::row(__('Pages', 'kcpw-address-autocomplete'), Html::radios('f[pages][mode]', (string) $pages['mode'], [
            'checkout' => __('The WooCommerce checkout page', 'kcpw-address-autocomplete'),
            'all' => __('Every page (only choose this if the form is in a footer or pop-up)', 'kcpw-address-autocomplete'),
            'selected' => __('Only the pages chosen below', 'kcpw-address-autocomplete'),
        ], __('Pages', 'kcpw-address-autocomplete')) . '<br>' . Html::checkbox('f[pages][account_address]', 'kcpw-aa-f-account', ($pages['account_address'] ?? false) === true, __('Also on the My Account "Edit address" screens', 'kcpw-address-autocomplete')));
        $options = '';
        foreach ((array) get_pages(['number' => 200, 'post_status' => 'publish', 'sort_column' => 'post_title']) as $page) {
            if (is_object($page) && isset($page->ID, $page->post_title)) {
                $options .= '<option value="' . (int) $page->ID . '"' . (in_array((int) $page->ID, $pages['ids'], true) ? ' selected' : '') . '>' . Html::h((string) $page->post_title) . '</option>';
            }
        }
        $out .= Html::row(__('Chosen pages', 'kcpw-address-autocomplete'), '<select name="f[pages][ids][]" id="kcpw-aa-f-pages" multiple size="6" class="kcpw-aa-multi">' . $options . '</select>', __('Hold Ctrl (or Cmd) to choose several. Used when "only the pages chosen" is selected.', 'kcpw-address-autocomplete'), 'kcpw-aa-f-pages');
        $out .= Html::row(__('Or by address', 'kcpw-address-autocomplete'), '<textarea name="f[pages][paths]" id="kcpw-aa-f-paths" rows="3" class="large-text code" maxlength="2000">' . Html::h(implode("\n", $pages['paths'])) . '</textarea>', __('One path per line, for example /contact/ or /shop/* (everything under /shop/).', 'kcpw-address-autocomplete'), 'kcpw-aa-f-paths');
        $out .= '</tbody></table>';

        $out .= '<h2>' . Html::h(__('Different from your general settings (optional)', 'kcpw-address-autocomplete')) . '</h2><table class="form-table" role="presentation"><tbody>';
        $out .= Html::row(__('Countries', 'kcpw-address-autocomplete'), Html::text('f[countries]', 'kcpw-aa-f-countries', implode(', ', $form['countries']), 'regular-text', 'maxlength="40" placeholder="' . Html::a(__('use the general setting', 'kcpw-address-autocomplete')) . '"'), __('Up to five two-letter country codes.', 'kcpw-address-autocomplete'), 'kcpw-aa-f-countries');
        $out .= Html::row(__('Language', 'kcpw-address-autocomplete'), Html::text('f[language]', 'kcpw-aa-f-language', (string) $form['language'], 'small-text', 'maxlength="8"'), __('A language code such as en or fr.', 'kcpw-address-autocomplete'), 'kcpw-aa-f-language');
        $out .= Html::row(__('What to suggest', 'kcpw-address-autocomplete'), Html::select('f[place_types]', 'kcpw-aa-f-types', (string) $form['place_types'], ['' => __('Use the general setting', 'kcpw-address-autocomplete'), 'address' => __('Street addresses', 'kcpw-address-autocomplete'), 'all' => __('Everything', 'kcpw-address-autocomplete'), 'cities' => __('Cities only', 'kcpw-address-autocomplete'), 'regions' => __('Regions only', 'kcpw-address-autocomplete'), 'business' => __('Businesses', 'kcpw-address-autocomplete')]), '', 'kcpw-aa-f-types');
        $out .= '</tbody></table>';
        $out .= $this->featureRows($form);

        $out .= '<p class="submit"><button type="submit" class="button button-primary">' . Html::h(__('Save form', 'kcpw-address-autocomplete')) . '</button></p></form>';
        $out .= self::pickerDialogHtml();
        return $out . '</div>';
    }

    /**
     * Per-form switches for the optional features. Only shown for features that are on in Settings: nothing here can turn a feature on.
     *
     * @param array<string, mixed> $form
     */
    private function featureRows(array $form): string
    {
        $modules = $this->store->settings['modules'] ?? [];
        $names = [
            'map_picker' => __('Let the customer pick the address on a map', 'kcpw-address-autocomplete'),
            'gps' => __('A "Use my location" button', 'kcpw-address-autocomplete'),
            'validation' => __('Check the address with Google and show a badge', 'kcpw-address-autocomplete'),
            'pobox' => __('Warn about PO box and military addresses', 'kcpw-address-autocomplete'),
        ];
        $rows = '';
        foreach ($names as $key => $label) {
            if (($modules[$key] ?? false) === true) {
                $rows .= '<p>' . Html::checkbox("f[features][$key]", "kcpw-aa-f-feature-$key", ($form['features'][$key] ?? false) === true, $label) . '</p>';
            }
        }
        if ($rows === '') {
            return '';
        }
        return '<h2>' . Html::h(__('Extra features on this form', 'kcpw-address-autocomplete')) . '</h2>' . $rows;
    }

    public static function pickerDialogHtml(): string
    {
        $out = '<dialog id="kcpw-aa-picker" class="kcpw-aa-picker" aria-labelledby="kcpw-aa-picker-title">';
        $out .= '<div class="kcpw-aa-picker__head"><h2 id="kcpw-aa-picker-title">' . Html::h(__('Pick a field', 'kcpw-address-autocomplete')) . '</h2>';
        $out .= '<button type="button" class="button" id="kcpw-aa-picker-close">' . Html::h(__('Close', 'kcpw-address-autocomplete')) . '</button></div>';
        $out .= '<div class="kcpw-aa-picker__bar"><label for="kcpw-aa-picker-page">' . Html::h(__('Page', 'kcpw-address-autocomplete')) . '</label> <select id="kcpw-aa-picker-page"></select> ';
        $out .= '<button type="button" class="button" id="kcpw-aa-picker-window">' . Html::h(__('Open in a new window', 'kcpw-address-autocomplete')) . '</button></div>';
        $out .= '<p class="kcpw-aa-picker__help" id="kcpw-aa-picker-help"></p>';
        $out .= '<div class="kcpw-aa-picker__body"><iframe id="kcpw-aa-picker-frame" title="' . Html::a(__('Your page: click the field you want', 'kcpw-address-autocomplete')) . '"></iframe>';
        $out .= '<div id="kcpw-aa-picker-results" class="kcpw-aa-picker__results" aria-live="polite"></div></div></dialog>';
        return $out;
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Handlers
    // ------------------------------------------------------------------------------------------------------------------

    /** Add a preset, toggle, delete or duplicate a form by its id. */
    public function onForms(): void
    {
        $this->guard();
        check_admin_referer('kcpw_aa_forms');
        $do = isset($_POST['do']) ? sanitize_key((string) wp_unslash($_POST['do'])) : '';
        $id = isset($_POST['id']) ? sanitize_key((string) wp_unslash($_POST['id'])) : '';
        $preset = isset($_POST['preset']) ? sanitize_key((string) wp_unslash($_POST['preset'])) : '';
        $ok = $this->formsAction($do, $id, $preset);
        $this->redirect(admin_url('admin.php?page=kcpw-aa-forms&kcpw_msg=' . ($ok ? 'saved' : 'error')));
    }

    public function formsAction(string $do, string $id, string $preset): bool
    {
        $forms = $this->store->forms;
        if ($do === 'add_preset') {
            if (!isset(Presets::all()[$preset]) || $preset === 'custom' || count($forms) >= FormConfig::MAX_FORMS) {
                return false;
            }
            $forms[] = FormConfig::blank($preset);
            $this->store->saveForms($forms);
            return true;
        }
        if (!in_array($do, ['toggle', 'delete', 'duplicate'], true)) {
            return false;
        }
        $found = false;
        $next = [];
        foreach ($forms as $form) {
            if (($form['id'] ?? '') !== $id) {
                $next[] = $form;
                continue;
            }
            $found = true;
            if ($do === 'toggle') {
                $form['enabled'] = !($form['enabled'] ?? false);
                $next[] = $form;
            } elseif ($do === 'duplicate') {
                $next[] = $form;
                if (count($forms) < FormConfig::MAX_FORMS) {
                    $copy = FormConfig::duplicate($form);
                    // A copy starts switched off, so duplicating can never put something new in front of customers.
                    $copy['enabled'] = false;
                    $next[] = $copy;
                }
            }
        }
        if (!$found) {
            return false;
        }
        $this->store->saveForms($next);
        return true;
    }

    public function onFormSave(): void
    {
        $this->guard();
        check_admin_referer('kcpw_aa_form_save');
        $raw = isset($_POST['f']) && is_array($_POST['f']) ? wp_unslash($_POST['f']) : [];
        $id = isset($_POST['id']) ? sanitize_key((string) wp_unslash($_POST['id'])) : '';
        $preset = isset($_POST['preset']) ? sanitize_key((string) wp_unslash($_POST['preset'])) : 'custom';
        $result = $this->saveForm($id, $preset, $raw);
        $back = $result === 'saved'
            ? admin_url('admin.php?page=kcpw-aa-forms&kcpw_msg=saved')
            : admin_url('admin.php?page=kcpw-aa-forms&' . ($id !== '' ? 'edit=' . $id : 'new=' . $preset) . '&kcpw_msg=' . $result);
        $this->redirect($back);
    }

    /**
     * @param array<string, mixed> $raw the posted `f` array
     * @return string saved|needs_selector|error
     */
    public function saveForm(string $id, string $preset, array $raw): string
    {
        $existing = $id !== '' ? $this->store->form($id) : null;
        if ($id !== '' && $existing === null) {
            return 'error';
        }
        $candidate = $raw;
        $candidate['id'] = $existing['id'] ?? FormConfig::newId();
        $candidate['preset'] = $existing['preset'] ?? $preset;
        // Switches an unticked box does not send are "off", and the groups arrive as a list.
        if (isset($candidate['groups']) && is_array($candidate['groups'])) {
            $candidate['groups'] = array_values($candidate['groups']);
        }
        $clean = FormConfig::sanitize($candidate);
        if ($clean === null) {
            return 'needs_selector';
        }
        $forms = $this->store->forms;
        if ($existing !== null) {
            foreach ($forms as $i => $form) {
                if (($form['id'] ?? '') === $existing['id']) {
                    $forms[$i] = $clean;
                }
            }
        } else {
            if (count($forms) >= FormConfig::MAX_FORMS) {
                return 'error';
            }
            $forms[] = $clean;
        }
        $this->store->saveForms($forms);
        return 'saved';
    }

    public function onExport(): void
    {
        $this->guard();
        check_admin_referer('kcpw_aa_export');
        $this->send(FormConfig::export($this->store->forms), 'kcpw-address-forms.json');
    }

    public function onImport(): void
    {
        $this->guard();
        check_admin_referer('kcpw_aa_import');
        $json = isset($_POST['json']) ? (string) wp_unslash($_POST['json']) : '';
        $imported = FormConfig::import($json);
        if ($imported === null) {
            $this->redirect(admin_url('admin.php?page=kcpw-aa-forms&kcpw_msg=bad_import'));
            return;
        }
        // An imported form arrives switched OFF: importing can never put something new in front of customers.
        foreach ($imported as $i => $form) {
            $imported[$i]['enabled'] = false;
        }
        $room = max(0, FormConfig::MAX_FORMS - count($this->store->forms));
        $take = array_slice($imported, 0, $room);
        $this->store->saveForms(array_merge($this->store->forms, $take));
        $this->redirect(admin_url('admin.php?page=kcpw-aa-forms&kcpw_msg=imported&kcpw_n=' . count($take)));
    }

    public static function exportUrl(): string
    {
        return wp_nonce_url(admin_url('admin-post.php?action=kcpw_aa_export'), 'kcpw_aa_export');
    }

    /** Overridden in tests: the real ones end the request. */
    protected function redirect(string $url): void
    {
        wp_safe_redirect($url);
        exit;
    }

    protected function send(string $body, string $filename): void
    {
        nocache_headers();
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('X-Content-Type-Options: nosniff');
        echo $body; // phpcs:ignore WordPress.Security.EscapeOutput -- a JSON download, not a page
        exit;
    }

    private function guard(): void
    {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('You do not have permission to do that.', 'kcpw-address-autocomplete'), '', ['response' => 403]);
        }
    }

    /** @param array<string, mixed> $form */
    private static function whereText(array $form): string
    {
        $mode = $form['pages']['mode'] ?? 'selected';
        $text = match ($mode) {
            'checkout' => __('The WooCommerce checkout page', 'kcpw-address-autocomplete'),
            'all' => __('Every page', 'kcpw-address-autocomplete'),
            default => __('Selected pages', 'kcpw-address-autocomplete'),
        };
        return ($form['pages']['account_address'] ?? false) === true ? $text . ' + ' . __('My Account addresses', 'kcpw-address-autocomplete') : $text;
    }
}
