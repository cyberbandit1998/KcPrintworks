<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Repo\MemoryQuoteRepository;
use KcPrintworks\Quotes\Repo\QuoteRepository;

final class MemoryRepositoryTest extends TestCase
{
    use RepositoryContract;

    protected function repo(): QuoteRepository
    {
        return new MemoryQuoteRepository();
    }
}
