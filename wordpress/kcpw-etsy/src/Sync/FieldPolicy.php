<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Sync;

/**
 * Who owns each field (docs/ETSY-INTEGRATION.md section 7). Etsy is the master catalog, so Etsy-owned fields flow
 * from Etsy to WooCommerce; website-owned fields are never written by synchronization.
 */
final class FieldPolicy
{
    public const OWNER_ETSY = 'etsy';
    public const OWNER_WEBSITE = 'website';

    public const TITLE = 'title';
    public const DESCRIPTION = 'description';
    public const IMAGES = 'images';
    public const VARIATIONS = 'variations';
    public const BASE_PRICE = 'base_price';
    public const PERSONALIZATION = 'personalization';
    public const LISTING_STATE = 'listing_state';
    public const STOCK = 'stock';

    public const SLUG = 'slug';
    public const CATEGORIES = 'categories';
    public const SEO = 'seo';
    public const SHIPPING = 'shipping';
    public const TAX = 'tax';
    public const VISIBILITY = 'visibility';
    public const WEBSITE_PRICE = 'website_price';

    /** @var array<string,string> */
    private const OWNERS = [
        self::TITLE => self::OWNER_ETSY,
        self::DESCRIPTION => self::OWNER_ETSY,
        self::IMAGES => self::OWNER_ETSY,
        self::VARIATIONS => self::OWNER_ETSY,        // structure, option values (colors), SKUs
        self::BASE_PRICE => self::OWNER_ETSY,        // the Etsy price; the website price is derived by PricePolicy
        self::PERSONALIZATION => self::OWNER_ETSY,   // Etsy's own personalization settings, read to seed a structured form
        self::LISTING_STATE => self::OWNER_ETSY,     // reported; acting on it is a separate policy
        self::STOCK => self::OWNER_ETSY,             // only through the inventory policy
        self::SLUG => self::OWNER_WEBSITE,           // the website's SEO URL
        self::CATEGORIES => self::OWNER_WEBSITE,
        self::SEO => self::OWNER_WEBSITE,
        self::SHIPPING => self::OWNER_WEBSITE,       // shipping class, weight, dimensions, and the rules built on them
        self::TAX => self::OWNER_WEBSITE,
        self::VISIBILITY => self::OWNER_WEBSITE,
        self::WEBSITE_PRICE => self::OWNER_WEBSITE,  // owned by the price policy, not copied from Etsy
    ];

    /** @return array<string,string> */
    public static function owners(): array
    {
        return self::OWNERS;
    }

    public static function ownerOf(string $field): string
    {
        return self::OWNERS[$field] ?? throw new \InvalidArgumentException('Unknown field: ' . $field);
    }

    /** @return list<string> */
    public static function etsyOwned(): array
    {
        return array_keys(array_filter(self::OWNERS, static fn (string $o): bool => $o === self::OWNER_ETSY));
    }

    /** @return list<string> */
    public static function websiteOwned(): array
    {
        return array_keys(array_filter(self::OWNERS, static fn (string $o): bool => $o === self::OWNER_WEBSITE));
    }

    /** Synchronization may write this field (subject to approval, preview, and overrides). */
    public static function syncMayWrite(string $field): bool
    {
        return self::ownerOf($field) === self::OWNER_ETSY;
    }
}
