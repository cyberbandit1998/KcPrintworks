<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

/** WooCommerce could not make the order (the message is for the log, not for the customer). */
final class OrderFailed extends \RuntimeException
{
}
