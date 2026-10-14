<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Api;

/**
 * Builds the `x-api-key` header value. Etsy may require the shared secret as `keystring:secret` (To verify on the first
 * real call), so the format is a setting and lives in this one place.
 */
final class ApiKeyHeader
{
    public function __construct(
        private readonly string $keystring,
        private readonly string $sharedSecret = '',
        private readonly bool $includeSecret = false,
    ) {
        if ($keystring === '') {
            throw new \InvalidArgumentException('The Etsy API key (keystring) is not configured.');
        }
        if ($includeSecret && $sharedSecret === '') {
            throw new \InvalidArgumentException('The shared secret is required when it is included in the header.');
        }
    }

    public function value(): string
    {
        return $this->includeSecret ? $this->keystring . ':' . $this->sharedSecret : $this->keystring;
    }
}
