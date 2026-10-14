<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Wp;

use KcPrintworks\Core\Handoff\HandoffStore;

final class WpHandoffStore implements HandoffStore
{
    public function put(string $tokenHash, string $payloadJson, int $expiresAt): void
    {
        global $wpdb;
        $table = Schema::table();
        $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE expires_at < %d", time() - 3600));
        $ok = $wpdb->insert($table, ['token_hash' => $tokenHash, 'payload' => $payloadJson, 'expires_at' => $expiresAt], ['%s', '%s', '%d']);
        if ($ok === false) {
            throw new \RuntimeException('Could not store the cart handoff.');
        }
    }

    public function take(string $tokenHash, int $now): ?string
    {
        global $wpdb;
        $table = Schema::table();
        $row = $wpdb->get_row($wpdb->prepare("SELECT payload, expires_at FROM {$table} WHERE token_hash = %s", $tokenHash), ARRAY_A);
        if (!is_array($row)) {
            return null;
        }
        // Whoever deletes the row owns the token. Two simultaneous requests cannot both see "1 row deleted".
        $deleted = $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE token_hash = %s", $tokenHash));
        if ($deleted !== 1) {
            return null;
        }
        return (int) $row['expires_at'] >= $now ? (string) $row['payload'] : null;
    }
}
