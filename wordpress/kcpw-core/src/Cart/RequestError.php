<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Cart;

/** A request that does not follow the contract. Carries every problem found so the caller can show them all. */
final class RequestError extends \InvalidArgumentException
{
    /** @param list<string> $problems */
    public function __construct(public readonly array $problems)
    {
        parent::__construct(implode(' ', $problems));
    }
}
