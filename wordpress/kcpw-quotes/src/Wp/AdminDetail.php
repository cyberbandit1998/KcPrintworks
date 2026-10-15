<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Repo\QuoteEvent;
use KcPrintworks\Quotes\Repo\QuoteFile;
use KcPrintworks\Quotes\Repo\QuoteNote;

/** Everything the detail screen shows, gathered by AdminScreens so AdminViews only has to draw it. */
final class AdminDetail
{
    /**
     * @param list<QuoteFile> $files
     * @param list<QuoteNote> $notes
     * @param list<QuoteEvent> $events
     * @param array<string,string> $form values to show in the offer form (what was last typed, or what is saved)
     * @param array{type:string,messages:list<string>}|null $notice
     */
    public function __construct(
        public readonly Quote $quote,
        public readonly array $files,
        public readonly array $notes,
        public readonly array $events,
        public readonly array $form,
        public readonly ?array $notice,
        public readonly string $orderLink,
        public readonly string $orderStatus,
        public readonly bool $canSendLink,
    ) {
    }
}
