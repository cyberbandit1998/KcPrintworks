<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Catalog;

final class ArrayProductSource implements ProductSource
{
    /** @param array<int,ProductModel> $products */
    public function __construct(private array $products = [])
    {
    }

    public function add(ProductModel $product): void
    {
        $this->products[$product->id] = $product;
    }

    public function find(int $productId): ?ProductModel
    {
        return $this->products[$productId] ?? null;
    }
}
