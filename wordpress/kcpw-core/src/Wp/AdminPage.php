<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Options\OptionSchema;
use KcPrintworks\Core\Options\SchemaError;

/** WooCommerce > Checkout link: one page that says whether the cart handoff is ready, and what to fix if not. */
final class AdminPage
{
    public const SLUG = 'kcpw-checkout';

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
    }

    public function menu(): void
    {
        add_submenu_page('woocommerce', 'Checkout link', 'Checkout link', 'manage_woocommerce', self::SLUG, [$this, 'render']);
    }

    public function render(): void
    {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('You do not have permission to see this page.', 'kcpw-core'), '', ['response' => 403]);
        }
        global $wpdb;
        $table = Schema::table();
        $tableExists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
        $pending = $tableExists ? (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE expires_at >= %d", time())) : 0;

        $personalized = [];
        $broken = [];
        $ids = get_posts(['post_type' => 'product', 'post_status' => 'any', 'posts_per_page' => 500, 'fields' => 'ids', 'meta_key' => WcProductSource::META_SCHEMA]);
        foreach ($ids as $id) {
            $json = get_post_meta((int) $id, WcProductSource::META_SCHEMA, true);
            try {
                $schema = OptionSchema::fromJson((string) $json);
                $personalized[(int) $id] = count($schema->fields);
            } catch (SchemaError $e) {
                $broken[] = get_the_title((int) $id) . ' (#' . (int) $id . ')';
            }
        }
        $stripe = Readiness::stripe();
        $checks = Readiness::checks([
            'secretLength' => strlen(Config::secret()),
            'storefront' => Config::storefrontUrl(),
            'https' => is_ssl() || str_starts_with((string) home_url(), 'https://'),
            'permalinks' => (string) get_option('permalink_structure') !== '',
            'tableExists' => $tableExists,
            'wooActive' => class_exists('WooCommerce'),
            'stripeActive' => $stripe['active'],
            'stripeTestMode' => $stripe['testMode'],
            'brokenSchemas' => $broken,
            'pendingHandoffs' => $pending,
        ]);
        $icons = ['pass' => 'Ready', 'warn' => 'Check', 'fail' => 'Fix'];

        echo '<div class="wrap"><h1>Checkout link</h1>';
        echo '<p>The storefront sends shoppers here to pay. This page only reports; it changes nothing. Real payments need your approval first: keep Stripe in test mode until then.</p>';
        echo '<table class="widefat striped" style="max-width:56rem"><caption class="screen-reader-text">Checkout readiness</caption><thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">What to do</th></tr></thead><tbody>';
        foreach ($checks as $check) {
            echo '<tr><td>' . esc_html($check['label']) . '</td><td><strong>' . esc_html($icons[$check['status']] ?? $check['status']) . '</strong></td><td>' . esc_html($check['detail']) . '</td></tr>';
        }
        echo '</tbody></table>';
        echo '<h2>Personalized products</h2>';
        if ($personalized === []) {
            echo '<p>None yet. Open a product, choose the <strong>Personalization</strong> tab in Product data, and add the fields shoppers fill in.</p>';
        } else {
            echo '<ul>';
            foreach ($personalized as $id => $count) {
                echo '<li><a href="' . esc_url((string) get_edit_post_link($id)) . '">' . esc_html(get_the_title($id)) . '</a> &mdash; ' . (int) $count . ' field(s)</li>';
            }
            echo '</ul>';
        }
        echo '</div>';
    }
}
