<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

use KcPrintworks\Quotes\Mail\Emails;
use KcPrintworks\Quotes\Mail\Mailer;
use KcPrintworks\Quotes\Repo\QuoteRepository;
use KcPrintworks\Quotes\Upload\FileStore;

/** The parts every part of the workflow shares, so each service takes one argument. */
final class Context
{
    /** @param callable(): int $clock @param callable(int): string $adminUrl */
    public function __construct(
        public readonly QuoteRepository $repo,
        public readonly OrderGateway $orders,
        public readonly Mailer $mailer,
        public readonly Emails $emails,
        public readonly Settings $settings,
        public readonly FileStore $files,
        private $clock,
        private $adminUrl,
    ) {
    }

    public function now(): int
    {
        return ($this->clock)();
    }

    public function adminUrl(int $quoteId): string
    {
        return ($this->adminUrl)($quoteId);
    }

    public function event(int $quoteId, string $actor, string $kind, string $detail): void
    {
        $this->repo->addEvent($quoteId, $actor, $kind, $detail, $this->now());
    }

    /** Puts a quote on the dashboard's "needs attention" list, with the reason. */
    public function flag(int $quoteId, string $reason, bool $mailOwner = false): void
    {
        $this->repo->swap($quoteId, [], ['attention' => 1, 'attention_reason' => $reason], [], $this->now());
        $this->event($quoteId, 'system', 'attention', $reason);
        if ($mailOwner) {
            $quote = $this->repo->find($quoteId);
            if ($quote !== null) {
                $this->mailer->send($this->emails->needsAttentionOwner($quote, $reason, $this->adminUrl($quoteId)));
            }
        }
    }
}
