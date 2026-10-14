<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

require_once __DIR__ . '/wp-stubs.php';

use KcPrintworks\Core\Cart\LineResolver;
use KcPrintworks\Core\Catalog\ArrayProductSource;
use KcPrintworks\Core\Catalog\ProductModel;
use KcPrintworks\Core\Handoff\HandoffService;
use KcPrintworks\Core\Handoff\MemoryHandoffStore;
use KcPrintworks\Core\Support\Json;

/** Shared setup for the tests of the WordPress glue. */
final class GlueFixtures
{
    public const SECRET = KCPW_HANDOFF_SECRET;

    public static function vectorProducts(): ArrayProductSource
    {
        $vectors = Json::decode((string) file_get_contents(dirname(__DIR__, 3) . '/packages/contracts/test/vectors/lines.json'));
        $source = new ArrayProductSource();
        foreach (get_object_vars($vectors->products) as $dto) {
            $source->add(ProductModel::fromDto(Json::assoc($dto)));
        }
        return $source;
    }

    public static function service(?ArrayProductSource $products = null, ?MemoryHandoffStore $store = null, int $tokenStart = 1): HandoffService
    {
        $n = $tokenStart - 1;
        return new HandoffService(
            $products ?? self::vectorProducts(),
            $store ?? new MemoryHandoffStore(),
            new LineResolver(),
            'https://shop.example.com',
            static fn (): int => time(),
            static function () use (&$n): string {
                return str_pad('t' . ++$n, 43, 'x');
            },
        );
    }

    public static function token(int $n): string
    {
        return str_pad('t' . $n, 43, 'x');
    }

    /** A WooCommerce product stub registered under its id. */
    public static function product(int $id, string $name, string $price = '10.00', array $meta = []): \WC_Product
    {
        $p = new \WC_Product($id, $name);
        $p->price = $price;
        $p->meta = $meta;
        \WpStub::$products[$id] = $p;
        return $p;
    }
}
