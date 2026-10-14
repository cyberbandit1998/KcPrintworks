<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/**
 * The read-only phase requests read scopes and nothing else. Etsy is the master catalog and this plugin never
 * writes to Etsy, so no write (`*_w`) or delete (`*_d`) scope is ever requested, and email (`email_r`) stays off.
 * Scope names are from the public v3 documentation (To verify against the vendored OpenAPI spec).
 */
final class Scopes
{
    /** Needed for the product import preview. */
    public const PRODUCT_IMPORT = ['shops_r', 'listings_r'];

    private const ALLOWED = ['shops_r', 'listings_r', 'transactions_r'];

    /**
     * @param list<string> $scopes
     * @return list<string>
     */
    public static function assertReadOnly(array $scopes): array
    {
        if ($scopes === []) {
            throw new \InvalidArgumentException('At least one scope is required.');
        }
        foreach ($scopes as $scope) {
            if (!in_array($scope, self::ALLOWED, true)) {
                throw new \InvalidArgumentException(sprintf('Scope "%s" is not allowed: only %s may be requested.', $scope, implode(', ', self::ALLOWED)));
            }
        }
        return array_values(array_unique($scopes));
    }
}
