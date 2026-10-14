<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Api;

class ApiError extends \RuntimeException
{
    public function __construct(string $message, public readonly int $status = 0)
    {
        parent::__construct($message, $status);
    }
}
