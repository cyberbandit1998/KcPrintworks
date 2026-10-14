<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

/**
 * The read-only phase is enforced by tests, not just promised: this plugin must contain no call that creates, changes,
 * or deletes a WooCommerce product, variation, term, attachment, or order, and no way to write to Etsy. It may write
 * only its own tables, options, transients, and scheduled events.
 */
final class ReadOnlySafetyTest extends TestCase
{
    /** @return list<string> */
    private function sources(): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(dirname(__DIR__) . '/src', \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && str_ends_with($file->getFilename(), '.php')) {
                $files[] = $file->getPathname();
            }
        }
        foreach ([dirname(__DIR__) . '/kcpw-etsy.php', dirname(__DIR__) . '/uninstall.php'] as $extra) {
            if (is_file($extra)) {
                $files[] = $extra;
            }
        }
        sort($files);
        return $files;
    }

    /** Strips comments (and, by default, string contents) so documentation cannot trip or hide a finding. */
    private function code(string $path, bool $keepStrings = false): string
    {
        $blank = [T_COMMENT, T_DOC_COMMENT, T_INLINE_HTML];
        if (!$keepStrings) {
            $blank[] = T_CONSTANT_ENCAPSED_STRING;
        }
        $out = '';
        foreach (token_get_all((string) file_get_contents($path)) as $token) {
            if (is_array($token)) {
                if (in_array($token[0], $blank, true)) {
                    $out .= ' ';
                    continue;
                }
                $out .= $token[1];
            } else {
                $out .= $token;
            }
        }
        return $out;
    }

    public function testNoCodeCanWriteToProductsTermsAttachmentsOrOrders(): void
    {
        $forbidden = [
            'wp_insert_post', 'wp_update_post', 'wp_delete_post', 'wp_trash_post', 'wp_untrash_post', 'wp_publish_post',
            'update_post_meta', 'add_post_meta', 'delete_post_meta', 'update_metadata', 'add_metadata', 'delete_metadata',
            'wp_set_object_terms', 'wp_set_post_terms', 'wp_insert_term', 'wp_update_term', 'wp_delete_term',
            'wp_insert_attachment', 'wp_generate_attachment_metadata', 'media_sideload_image', 'media_handle_sideload', 'download_url',
            'wc_update_product_stock', 'wc_update_product_lookup_tables', 'wc_create_attribute', 'wc_create_order', 'wc_update_order',
            'wc_create_new_customer', 'wc_delete_product', 'wc_delete_order', 'wc_reduce_stock_levels', 'wc_maybe_reduce_stock_levels',
            'WC_Product_Simple', 'WC_Product_Variable', 'WC_Product_Variation', 'WC_Order', 'WC_Order_Item', 'WC_Product_Attribute',
            'wp_remote_post', 'wp_remote_put', 'curl_setopt', 'curl_exec', 'file_put_contents', 'unlink', 'rename', 'copy', 'mkdir', 'touch',
        ];
        foreach ($this->sources() as $path) {
            $code = $this->code($path);
            foreach ($forbidden as $name) {
                $this->assertSame(0, preg_match('/(?<![\w\\\\])' . preg_quote($name, '/') . '\b/', $code), basename($path) . ' uses ' . $name);
            }
            // fwrite is allowed only to build an in-memory stream for CSV parsing, never a file.
            if (preg_match('/(?<![\w\\\\])fwrite\b/', $code) === 1) {
                $this->assertStringContains('php://temp', (string) file_get_contents($path), basename($path) . ' writes to something other than php://temp');
            }
        }
    }

    public function testProductObjectsAreNeverMutated(): void
    {
        foreach ($this->sources() as $path) {
            $code = $this->code($path, true);
            $this->assertSame(0, preg_match('/->\s*(set_[a-z_]+\s*\(|save\s*\(\s*\)|delete\s*\(\s*(true|false)?\s*\)|update_meta_data\s*\(|add_meta_data\s*\(|delete_meta_data\s*\()/', $code), basename($path) . ' calls a mutating product method');
        }
    }

    public function testDatabaseWritesTouchOnlyThePluginsOwnTables(): void
    {
        foreach ($this->sources() as $path) {
            $code = $this->code($path);
            if (preg_match_all('/\$wpdb->(insert|update|delete|replace|query)\s*\(([^;]*);/s', $code, $matches, PREG_SET_ORDER) > 0) {
                foreach ($matches as $m) {
                    $own = str_contains($m[2], 'Schema::') || (basename($path) === 'Schema.php' && str_contains($m[2], 'self::table('));
                    $this->assertTrue($own, basename($path) . ': a $wpdb write that is not on a plugin table: ' . substr($m[0], 0, 80));
                }
            }
        }
    }

    public function testTheOnlyNonGetRequestTheCodeCanSendIsTheOAuthTokenCall(): void
    {
        $methods = [];
        foreach ($this->sources() as $path) {
            if (preg_match_all("/new\s+\\\\?(?:[A-Za-z_]+\\\\)*Request\(\s*'([A-Z]+)'/", (string) file_get_contents($path), $found) > 0) {
                foreach ($found[1] as $method) {
                    $methods[basename($path)][] = $method;
                }
            }
        }
        $this->assertSame(['EtsyClient.php' => ['GET'], 'OAuthClient.php' => ['POST']], $methods);
    }

    public function testNoRequestedScopeCanWriteOrDeleteOnEtsy(): void
    {
        foreach ($this->sources() as $path) {
            $text = (string) file_get_contents($path);
            if (str_ends_with($path, 'Oauth/Scopes.php')) {
                continue; // it names the refused scopes in a message only; its allowlist is checked below
            }
            $this->assertSame(0, preg_match("/['\"](?:listings|transactions|shops|profile|address|billing|cart|favorites|feedback|recommend)_(?:w|d)['\"]/", $text), basename($path) . ' names a write or delete scope');
        }
        $scopes = (string) file_get_contents(dirname(__DIR__) . '/src/Oauth/Scopes.php');
        $this->assertSame(1, preg_match("/ALLOWED = \['shops_r', 'listings_r', 'transactions_r'\]/", $scopes));
    }

    public function testThePureCoreHasNoWordPressDependency(): void
    {
        foreach (['Api', 'Etsy', 'Http', 'Match', 'Model', 'Oauth', 'Report', 'Snapshot', 'Sync', 'Vault', 'Woo', 'Admin'] as $dir) {
            $base = dirname(__DIR__) . '/src/' . $dir;
            foreach (glob($base . '/*.php') ?: [] as $path) {
                $code = $this->code($path);
                $this->assertSame(0, preg_match('/(?<![\w\\\\>])(?:wp_[a-z_]+|get_option|update_option|add_action|add_filter|current_user_can|esc_[a-z]+|__)\s*\(/', $code), $dir . '/' . basename($path) . ' calls a WordPress function; WordPress access belongs in src/Wp');
            }
        }
    }
}
