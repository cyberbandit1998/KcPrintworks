<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

/**
 * Everything outside src/Wp must run without WordPress or WooCommerce, so it can be proven by the shared vectors and by
 * plain PHP tests. Also: nothing here may write to products, and nothing may contain payment code.
 */
final class CoreIsPureTest extends TestCase
{
    /** @return list<string> */
    private function phpFiles(string $dir): array
    {
        $out = [];
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $out[] = $file->getPathname();
            }
        }
        sort($out);
        return $out;
    }

    public function testTheCoreCallsNoWordPressOrWooCommerceFunctions(): void
    {
        $src = dirname(__DIR__) . '/src';
        $checked = 0;
        foreach ($this->phpFiles($src) as $file) {
            if (str_contains($file, '/src/Wp/')) {
                continue;
            }
            $checked++;
            $code = (string) file_get_contents($file);
            $this->assertSame(0, preg_match('/(?<![\w>:$\\\\])(?:add_action|add_filter|apply_filters|do_action|get_option|update_option|get_post_meta|update_post_meta|wp_[a-z_]+|wc_[a-z_]+|esc_[a-z]+|sanitize_[a-z_]+|__|_e|is_admin|current_user_can|WC)\s*\(/', $code), basename($file) . ' calls a WordPress or WooCommerce function');
            $this->assertSame(0, preg_match('/\bWC_[A-Z]|\bWP_[A-Z]|\$wpdb/', $code), basename($file) . ' mentions a WordPress or WooCommerce class');
        }
        $this->assertTrue($checked > 15, 'the scan looked at the core files');
    }

    public function testNothingWritesToProductsAndNothingTouchesPayments(): void
    {
        $forbidden = [
            '/->(?:save|delete|set_[a-z_]+|update_meta_data|add_meta_data)\s*\(/' => 'writes through a product object',
            '/\b(?:wp_insert_post|wp_update_post|wp_delete_post|wp_trash_post|wc_create_[a-z_]+|update_post_meta|add_post_meta)\s*\(/' => 'writes posts',
            '/api\.stripe\.com|\\\\Stripe\\\\|[sp]k_(?:live|test)|payment_?intent|card_?number|\bcvc\b/i' => 'payment code (the official Stripe plugin takes payments; this plugin only reads whether it is active)',
            '/api\.etsy|etsy/i' => 'an Etsy reference',
        ];
        $allowed = [
            // The three deliberate writes, each reviewed: our own meta key, our own cart item, our own order item.
            'PersonalizationPanel.php' => ['update_post_meta', 'delete_post_meta'],
            'CartHooks.php' => ['set_price', 'add_meta_data'],
            'Redeemer.php' => ['set_customer_session_cookie'], // the shopper's own session, not a product
        ];
        foreach ($this->phpFiles(dirname(__DIR__) . '/src') as $file) {
            $code = (string) preg_replace('#/\*.*?\*/|//[^\n]*#s', '', (string) file_get_contents($file));
            foreach ($forbidden as $pattern => $what) {
                if (preg_match_all($pattern, $code, $m)) {
                    foreach ($m[0] as $hit) {
                        $ok = false;
                        foreach ($allowed[basename($file)] ?? [] as $word) {
                            if (stripos($hit, $word) !== false) {
                                $ok = true;
                            }
                        }
                        $this->assertTrue($ok, basename($file) . ' ' . $what . ': "' . $hit . '"');
                    }
                }
            }
        }
    }
}
