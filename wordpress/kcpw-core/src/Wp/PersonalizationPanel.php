<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Options\SchemaError;
use KcPrintworks\Core\Options\SchemaForm;
use KcPrintworks\Core\Options\SchemaFormView;

/**
 * A "Personalization" tab in WooCommerce's Product data box: the shopper-facing fields for this product.
 * Stored as one versioned JSON value in product meta (_kcpw_option_schema). Saving never changes anything else on the product.
 */
final class PersonalizationPanel
{
    public const NONCE_ACTION = 'kcpw_save_personalization';
    public const NONCE_FIELD = 'kcpw_personalization_nonce';

    public function register(): void
    {
        add_filter('woocommerce_product_data_tabs', [$this, 'tab']);
        add_action('woocommerce_product_data_panels', [$this, 'panel']);
        add_action('woocommerce_process_product_meta', [$this, 'save'], 10, 1);
    }

    /**
     * @param array<string,array<string,mixed>> $tabs
     * @return array<string,array<string,mixed>>
     */
    public function tab(array $tabs): array
    {
        $tabs['kcpw_personalization'] = [
            'label' => __('Personalization', 'kcpw-core'),
            'target' => 'kcpw_personalization_data',
            'class' => [],
            'priority' => 75,
        ];
        return $tabs;
    }

    public function panel(): void
    {
        global $post;
        $postId = (int) ($post->ID ?? 0);
        $stored = $postId > 0 ? get_post_meta($postId, WcProductSource::META_SCHEMA, true) : '';
        $errors = [];
        try {
            $schema = is_string($stored) && trim($stored) !== '' ? OptionSchema::fromJson($stored) : OptionSchema::empty();
        } catch (SchemaError $e) {
            $schema = OptionSchema::empty();
            $errors[] = 'The saved setup is broken and this product cannot be sold until it is fixed: ' . $e->getMessage();
        }
        $key = $this->errorKey($postId);
        $pending = get_transient($key);
        if (is_array($pending)) {
            $errors = array_merge($errors, array_map('strval', $pending));
            delete_transient($key);
        }
        $json = $schema->isEmpty() ? '' : $schema->toJson();

        echo '<div id="kcpw_personalization_data" class="panel woocommerce_options_panel" style="padding:12px">';
        wp_nonce_field(self::NONCE_ACTION, self::NONCE_FIELD);
        echo SchemaFormView::render($schema, $errors, (int) wc_get_price_decimals()); // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside the view
        echo '<details style="margin-top:1em"><summary>Advanced: copy this setup to another product (JSON)</summary>'
            . '<p>Copy this text to reuse the same fields on another product, or paste a setup here to replace the table above. Leave it as it is to use the table.</p>'
            . '<input type="hidden" name="kcpw_schema_json_hash" value="' . esc_attr(md5($json)) . '">'
            . '<textarea name="kcpw_schema_json" rows="8" style="width:100%;font-family:monospace" aria-label="Personalization setup as JSON">' . esc_textarea($json) . '</textarea></details>';
        echo '</div>';
    }

    public function save(int $postId): void
    {
        $nonce = isset($_POST[self::NONCE_FIELD]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE_FIELD])) : '';
        if ($nonce === '' || !wp_verify_nonce($nonce, self::NONCE_ACTION)) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (!current_user_can('edit_post', $postId)) {
            return;
        }

        $decimals = (int) wc_get_price_decimals();
        $posted = isset($_POST['kcpw_schema_json']) ? trim((string) wp_unslash($_POST['kcpw_schema_json'])) : '';
        $original = isset($_POST['kcpw_schema_json_hash']) ? sanitize_text_field(wp_unslash((string) $_POST['kcpw_schema_json_hash'])) : '';
        $schema = null;
        $errors = [];
        if ($posted !== '' && md5($posted) !== $original) {
            try {
                $schema = OptionSchema::fromJson($posted);
            } catch (SchemaError $e) {
                $errors[] = $e->getMessage();
            }
        } else {
            $rows = isset($_POST['kcpw_fields']) && is_array($_POST['kcpw_fields']) ? wp_unslash($_POST['kcpw_fields']) : [];
            $result = SchemaForm::parse($rows, $decimals);
            $schema = $result['schema'];
            $errors = $result['errors'];
        }

        if ($schema === null || $errors !== []) {
            set_transient($this->errorKey($postId), $errors, 300);
            return; // what was saved before stays as it was
        }
        if ($schema->isEmpty()) {
            delete_post_meta($postId, WcProductSource::META_SCHEMA);
        } else {
            update_post_meta($postId, WcProductSource::META_SCHEMA, wp_slash($schema->toJson()));
        }
    }

    private function errorKey(int $postId): string
    {
        return 'kcpw_schema_err_' . get_current_user_id() . '_' . $postId;
    }
}
