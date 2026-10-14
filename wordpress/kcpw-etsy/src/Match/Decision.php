<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Match;

/** An owner decision about one Etsy listing. Recording a decision changes nothing in WooCommerce. */
final class Decision
{
    public const LINK = 'link';
    public const IGNORE = 'ignore';
    public const CREATE_NEW = 'create_new';

    public function __construct(
        public readonly int $etsyListingId,
        public readonly string $type,
        public readonly ?int $wooProductId = null,
        public readonly string $decidedBy = '',
        public readonly string $decidedAt = '',
        public readonly string $note = '',
    ) {
        if (!in_array($type, [self::LINK, self::IGNORE, self::CREATE_NEW], true)) {
            throw new \InvalidArgumentException('Unknown decision type.');
        }
        if ($type === self::LINK && ($wooProductId === null || $wooProductId < 1)) {
            throw new \InvalidArgumentException('A link decision needs a WooCommerce product id.');
        }
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'etsy_listing_id' => $this->etsyListingId,
            'type' => $this->type,
            'woo_product_id' => $this->wooProductId,
            'decided_by' => $this->decidedBy,
            'decided_at' => $this->decidedAt,
            'note' => $this->note,
        ];
    }

    /** @param array<string,mixed> $data */
    public static function fromArray(array $data): self
    {
        return new self(
            (int) ($data['etsy_listing_id'] ?? 0),
            (string) ($data['type'] ?? ''),
            isset($data['woo_product_id']) ? (int) $data['woo_product_id'] : null,
            (string) ($data['decided_by'] ?? ''),
            (string) ($data['decided_at'] ?? ''),
            (string) ($data['note'] ?? ''),
        );
    }
}
