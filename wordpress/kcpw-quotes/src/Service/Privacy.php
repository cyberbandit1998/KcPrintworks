<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

use KcPrintworks\Quotes\Domain\QuoteInput;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Support\Money;

/**
 * WordPress's "Export Personal Data" and "Erase Personal Data" tools, for custom quotes. Erasing removes what the customer gave us (name,
 * email, description, address, phone, pictures, the owner's notes about them) and keeps what the shop needs to keep as records: the
 * reference, status, dates and the amounts. A quote that is still live (offered, approved, being paid or made) is not erased.
 */
final class Privacy
{
    private const KEEP = [Status::QUOTED, Status::APPROVED, Status::PAID, Status::IN_PRODUCTION];

    public function __construct(private readonly Context $c)
    {
    }

    /** @return list<array{id:string,label:string,data:list<array{name:string,value:string}>}> */
    public function export(string $email): array
    {
        $groups = [];
        foreach ($this->c->repo->findByEmail($email) as $quote) {
            if ($quote->erased()) {
                continue;
            }
            $rows = [
                ['Reference', $quote->ref()],
                ['Status', Status::label($quote->status())],
                ['Received', $this->c->settings->longDate($quote->createdAt())],
                ['Name', $quote->name()],
                ['Email', $quote->email()],
                ['Project', QuoteInput::PROJECT_TYPES[$quote->projectType()] ?? $quote->projectType()],
                ['Game or theme', $quote->game()],
                ['Description', $quote->description()],
                ['Dimensions', $quote->dimensions()],
                ['Quantity', (string) $quote->quantity()],
                ['Colors', $quote->colors()],
                ['Needed by', $quote->deadline()],
                ['Ships to', $quote->shipTo()],
                ['Phone', $quote->phone()],
                ['Address given when approving', $quote->addressJson()],
            ];
            if ($quote->totalCents() > 0) {
                $rows[] = ['Quoted total', Money::display($quote->totalCents(), $quote->currency())];
            }
            foreach ($this->c->repo->files($quote->id()) as $file) {
                $rows[] = ['Picture', $file->displayName];
            }
            foreach ($this->c->repo->notes($quote->id()) as $note) {
                $rows[] = ['Note kept by the shop', $note->note];
            }
            $groups[] = [
                'id' => 'kcpw-quote-' . $quote->id(),
                'label' => 'Custom quote ' . $quote->ref(),
                'data' => array_values(array_map(static fn (array $r): array => ['name' => $r[0], 'value' => $r[1]], array_filter($rows, static fn (array $r): bool => $r[1] !== ''))),
            ];
        }
        return $groups;
    }

    /** @return array{removed:int,retained:int,messages:list<string>} */
    public function erase(string $email): array
    {
        $removed = 0;
        $retained = 0;
        $messages = [];
        foreach ($this->c->repo->findByEmail($email) as $quote) {
            if ($quote->erased()) {
                continue;
            }
            if (in_array($quote->status(), self::KEEP, true)) {
                $retained++;
                $messages[] = 'Custom quote ' . $quote->ref() . ' is still open (' . Status::label($quote->status()) . '), so its details were kept. Finish or cancel it, then erase again.';
                continue;
            }
            foreach ($this->c->repo->removeFiles($quote->id()) as $file) {
                try {
                    $this->c->files->delete($file->storedName);
                } catch (\Throwable) {
                    // The record is gone; a leftover random-named file is reported by the dashboard's health check.
                }
            }
            $this->c->repo->eraseNotes($quote->id());
            $this->c->repo->swap($quote->id(), [], [
                'name' => 'Erased', 'email' => '', 'description' => '', 'game' => '', 'dimensions' => '', 'colors' => '', 'ship_to' => '', 'deadline' => '',
                'address' => '', 'phone' => '', 'client_hash' => '', 'token_hash' => '', 'erased' => 1, 'attention' => 0, 'attention_reason' => '',
            ], [], $this->c->now());
            $this->c->event($quote->id(), 'system', 'privacy_erase', 'The customer\'s personal details were erased on request.');
            $removed++;
        }
        return ['removed' => $removed, 'retained' => $retained, 'messages' => $messages];
    }
}
