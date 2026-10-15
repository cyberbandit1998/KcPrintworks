<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Repo;

/** The reference number chosen for a new quote is already used (a 1 in a billion event; the caller picks another). */
final class RefTaken extends \RuntimeException
{
}
