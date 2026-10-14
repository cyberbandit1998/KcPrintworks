<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

final class Denied extends \RuntimeException
{
    public function __construct(string $message, public readonly int $httpStatus = 403)
    {
        parent::__construct($message);
    }
}
