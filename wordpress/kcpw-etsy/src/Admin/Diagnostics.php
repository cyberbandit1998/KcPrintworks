<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

use KcPrintworks\Etsy\Api\ApiError;
use KcPrintworks\Etsy\Api\EtsyClient;
use KcPrintworks\Etsy\Etsy\Normalizer;
use KcPrintworks\Etsy\Oauth\NeedsReauth;

/**
 * "Test connection": a handful of read-only calls that prove the connection works AND compare Etsy's real responses with
 * the shape this plugin expects. Anything different is reported by name, so a wrong assumption about the API surfaces
 * on the first run instead of as a silent mismatch later (docs/ETSY-INTEGRATION.md section 16).
 */
final class Diagnostics
{
    /** @return array{ok:bool,at:string,checks:list<array{name:string,status:string,detail:string}>} */
    public static function run(EtsyClient $client, ?int $shopId, string $now): array
    {
        $checks = [];
        $add = static function (string $name, string $status, string $detail) use (&$checks): void {
            $checks[] = ['name' => $name, 'status' => $status, 'detail' => $detail];
        };

        try {
            $me = $client->getMe();
            $missing = array_values(array_filter(['user_id', 'shop_id'], static fn (string $k): bool => !array_key_exists($k, $me)));
            $add('Identify the account (users/me)', $missing === [] ? 'pass' : 'warn', $missing === [] ? 'user ' . (int) $me['user_id'] . ', shop ' . (int) $me['shop_id'] : 'response is missing: ' . implode(', ', $missing));
            $shopId ??= isset($me['shop_id']) ? (int) $me['shop_id'] : null;
        } catch (NeedsReauth $e) {
            $add('Identify the account (users/me)', 'fail', 'Etsy rejected the stored authorization. Reconnect the shop.');
            return self::result($checks, $now);
        } catch (ApiError $e) {
            $add('Identify the account (users/me)', 'fail', $e->getMessage());
            return self::result($checks, $now);
        }
        if ($shopId === null) {
            $add('Find the shop', 'fail', 'No shop id came back, so nothing else can be checked.');
            return self::result($checks, $now);
        }

        try {
            $shop = $client->getShop($shopId);
            $add('Read the shop (shops/{id})', isset($shop['shop_name']) ? 'pass' : 'warn', isset($shop['shop_name']) ? (string) $shop['shop_name'] : 'no "shop_name" in the response');
        } catch (ApiError $e) {
            $add('Read the shop (shops/{id})', 'fail', $e->getMessage());
        }

        try {
            $page = $client->getListings($shopId, 'active', 1, 0);
            $add('List listings (shops/{id}/listings)', 'pass', $page['count'] . ' active listing(s)');
            $first = $page['results'][0] ?? null;
            if ($first !== null) {
                $listingId = (int) ($first['listing_id'] ?? 0);
                $inventory = $client->getInventory($listingId);
                $images = $client->getImages($listingId);
                $normalized = (new Normalizer())->normalize($first, $inventory, $images);
                $add('Listing, inventory, and image shape', $normalized->warnings === [] ? 'pass' : 'warn', $normalized->warnings === [] ? 'every expected field is present (listing ' . $listingId . ')' : implode('; ', array_slice($normalized->warnings, 0, 8)));
            }
        } catch (ApiError $e) {
            $add('List listings (shops/{id}/listings)', 'fail', $e->getMessage());
        }

        $quota = $client->lastQuota();
        if ($quota !== null && $quota->limitPerDay !== null) {
            $add('Rate limit headers', 'pass', sprintf('%s of %s requests left today', $quota->remainingToday ?? '?', $quota->limitPerDay));
        } else {
            $add('Rate limit headers', 'warn', 'No x-limit-per-day header came back; the daily budget cannot be tracked.');
        }
        return self::result($checks, $now);
    }

    /** @param list<array{name:string,status:string,detail:string}> $checks */
    private static function result(array $checks, string $now): array
    {
        $ok = true;
        foreach ($checks as $check) {
            $ok = $ok && $check['status'] !== 'fail';
        }
        return ['ok' => $ok, 'at' => $now, 'checks' => $checks];
    }
}
