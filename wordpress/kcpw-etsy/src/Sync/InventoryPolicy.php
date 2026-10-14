<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

use KcPrintworks\Etsy\Model\Listing;
use KcPrintworks\Etsy\Model\Variant;

/**
 * Stock rules that keep printable items from being marked out of stock by mistake (docs/ETSY-INTEGRATION.md section 12).
 *
 *  made_to_order  (default) WooCommerce does not manage stock and the item is always in stock. Etsy's quantity is IGNORED,
 *                 because a made-to-order listing often carries a placeholder quantity. Only an Etsy offering that is
 *                 switched off or deleted makes a variation unavailable.
 *  etsy_quantity  Etsy's quantity is mirrored into WooCommerce stock (for items that really are shelved).
 *  woo_managed    WooCommerce stock is left exactly as it is; nothing is synchronized.
 * A shared pool across both channels is reserved for later and needs the order import.
 */
final class InventoryPolicy
{
    public const MADE_TO_ORDER = 'made_to_order';
    public const ETSY_QUANTITY = 'etsy_quantity';
    public const WOO_MANAGED = 'woo_managed';

    public static function assertValid(string $policy): string
    {
        if (!in_array($policy, [self::MADE_TO_ORDER, self::ETSY_QUANTITY, self::WOO_MANAGED], true)) {
            throw new \InvalidArgumentException('Unknown inventory policy: ' . $policy);
        }
        return $policy;
    }

    /**
     * The WooCommerce stock settings this policy would produce for one Etsy variant, or null for "leave as is".
     * @return array{manage_stock:bool,status:string,quantity:?int,reason:string}|null
     */
    public static function forVariant(string $policy, Listing $listing, Variant $variant): ?array
    {
        self::assertValid($policy);
        if ($policy === self::WOO_MANAGED) {
            return null;
        }
        if ($variant->deleted || !$variant->enabled) {
            return ['manage_stock' => false, 'status' => 'outofstock', 'quantity' => null, 'reason' => 'switched off or removed on Etsy'];
        }
        if ($policy === self::MADE_TO_ORDER) {
            return ['manage_stock' => false, 'status' => 'instock', 'quantity' => null, 'reason' => 'made to order: Etsy quantity ignored'];
        }
        return [
            'manage_stock' => true,
            'status' => $variant->quantity > 0 ? 'instock' : 'outofstock',
            'quantity' => $variant->quantity,
            'reason' => 'Etsy quantity mirrored',
        ];
    }

    /** The default for a listing: made to order when Etsy says so or when the shop-wide default is made to order. */
    public static function defaultFor(Listing $listing, string $shopDefault = self::MADE_TO_ORDER): string
    {
        return $listing->madeToOrder() ? self::MADE_TO_ORDER : self::assertValid($shopDefault);
    }
}
