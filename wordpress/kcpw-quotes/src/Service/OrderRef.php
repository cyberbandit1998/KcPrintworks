<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

final class OrderRef
{
    public function __construct(public readonly int $orderId, public readonly string $payUrl)
    {
    }
}
