<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

/**
 * Everything outside src/Wp must run without WordPress or WooCommerce, so the rules that matter (who may approve, what is paid, what
 * counts as a payment) are proven by plain PHP tests. Also: no payment code, no card data, no Etsy, and no reading of request globals
 * anywhere but the dashboard's button handlers.
 */
final class PureCoreTest extends TestCase
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

    private function code(string $file): string
    {
        return (string) preg_replace('#/\*.*?\*/|//[^\n]*#s', '', (string) file_get_contents($file));
    }

    public function testTheRulesCallNoWordPressOrWooCommerceFunctions(): void
    {
        $checked = 0;
        foreach ($this->phpFiles(dirname(__DIR__) . '/src') as $file) {
            if (str_contains($file, '/src/Wp/')) {
                continue;
            }
            $checked++;
            $code = $this->code($file);
            $this->assertSame(0, preg_match('/(?<![\w>:$\\\\])(?:add_action|add_filter|apply_filters|do_action|get_option|update_option|get_post_meta|update_post_meta|wp_[a-z_]+|wc_[a-z_]+|esc_[a-z]+|sanitize_[a-z_]+|__|_e|is_admin|current_user_can|is_email|admin_url|home_url|WC)\s*\(/', $code), basename($file) . ' calls a WordPress or WooCommerce function');
            $this->assertSame(0, preg_match('/\bWC_[A-Z]|\bWP_[A-Z]|\$wpdb/', $code), basename($file) . ' mentions a WordPress or WooCommerce class');
        }
        $this->assertTrue($checked > 30, 'the scan looked at the core files (' . $checked . ')');
    }

    public function testNoPaymentCodeNoCardDataNoEtsyAnywhere(): void
    {
        $forbidden = [
            '/api\.stripe\.com|\\\\Stripe\\\\|[sp]k_(?:live|test)|payment_?intent|card_?number|\bcvc\b|\bpan\b/i' => 'payment code (the official Stripe plugin takes payments)',
            '/api\.etsy|etsy/i' => 'an Etsy reference',
            '/wp_insert_post|wp_update_post|wp_delete_post|update_post_meta|add_post_meta|wc_create_product|->set_regular_price|->set_price/' => 'a write to products',
            '/\$_(?:COOKIE|SERVER|FILES)\b/' => 'a request global that is not needed',
        ];
        foreach ($this->phpFiles(dirname(__DIR__) . '/src') as $file) {
            $code = $this->code($file);
            foreach ($forbidden as $pattern => $what) {
                $this->assertSame(0, preg_match($pattern, $code), basename($file) . ' has ' . $what);
            }
        }
    }

    public function testOnlyTheDashboardsButtonHandlersReadFormInput(): void
    {
        foreach ($this->phpFiles(dirname(__DIR__) . '/src') as $file) {
            if (basename($file) === 'AdminScreens.php') {
                continue;
            }
            $this->assertSame(0, preg_match('/\$_(?:GET|POST|REQUEST)\b/', $this->code($file)), basename($file) . ' reads request globals');
        }
    }

    public function testNoPriceOrStatusEverComesFromTheRequestBodies(): void
    {
        // The customer-facing services read prices only from the stored quote.
        foreach (['Customer.php', 'Intake.php'] as $name) {
            $code = $this->code(dirname(__DIR__) . '/src/Service/' . $name);
            $this->assertSame(0, preg_match('/\$(?:approval|body|input)->(?:itemCents|shipCents|price|total|amount|status|orderId)\b/', $code), $name . ' reads a price or status from the request');
        }
    }

    public function testEverySourceFileHasStrictTypes(): void
    {
        foreach ($this->phpFiles(dirname(__DIR__) . '/src') as $file) {
            $this->assertStringContains('declare(strict_types=1);', (string) file_get_contents($file), basename($file));
        }
    }
}
