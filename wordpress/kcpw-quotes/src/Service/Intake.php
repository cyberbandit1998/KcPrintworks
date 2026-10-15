<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Service;

use KcPrintworks\Quotes\Domain\QuoteInput;
use KcPrintworks\Quotes\Domain\Reference;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Mail\Emails;
use KcPrintworks\Quotes\Mail\Mailer;
use KcPrintworks\Quotes\Repo\QuoteRepository;
use KcPrintworks\Quotes\Repo\RefTaken;
use KcPrintworks\Quotes\Upload\FileStore;
use KcPrintworks\Quotes\Upload\ImagePolicy;
use KcPrintworks\Quotes\Upload\ImageSanitizer;

/**
 * A customer's request, from the storefront (already checked there and signed): checks it all again, counts requests per visitor and
 * overall, ignores an exact repeat, stores the pictures under random names, saves the request as New and sends the two emails.
 * Nothing in a request can carry a price, a status or an order: those fields do not exist for a request.
 */
final class Intake
{
    /** An identical request from the same person inside this time is the same request sent twice (a double click, a retry). */
    private const REPEAT_WINDOW = 600;

    /** @param callable(): int $now @param callable(int): string $adminUrl */
    public function __construct(
        private readonly QuoteRepository $repo,
        private readonly FileStore $files,
        private readonly ImageSanitizer $sanitizer,
        private readonly Mailer $mailer,
        private readonly Emails $emails,
        private readonly Settings $settings,
        private $now,
        private $adminUrl,
    ) {
    }

    public function submit(mixed $body): IntakeResult
    {
        $now = ($this->now)();
        if (!($body instanceof \stdClass)) {
            return IntakeResult::invalid([['field' => '', 'code' => 'invalid_type', 'message' => 'The request is not in the expected form.']]);
        }
        $extra = array_diff(array_keys(get_object_vars($body)), ['request', 'files', 'clientKey']);
        $clientKey = $body->clientKey ?? null;
        if ($extra !== [] || !is_string($clientKey) || preg_match('/^[0-9a-f]{64}$/D', $clientKey) !== 1) {
            return IntakeResult::invalid([['field' => '', 'code' => 'invalid_type', 'message' => 'The request is not in the expected form.']]);
        }

        $check = QuoteInput::validate($body->request ?? null);
        if (!$check->ok || $check->value === null) {
            return IntakeResult::invalid($check->issues);
        }
        $value = $check->value;
        $late = QuoteInput::deadlineProblem($value['deadline'], $this->settings->today($now));
        if ($late !== null) {
            return IntakeResult::invalid([['field' => 'deadline', 'code' => 'invalid_date', 'message' => $late === 'past' ? 'The date has already passed.' : 'Choose a date within the next two years.']]);
        }

        if ($this->repo->countSince($now - 3600, $clientKey) >= $this->settings->maxPerClientPerHour
            || $this->repo->countSince($now - 3600) >= $this->settings->maxAllPerHour) {
            return IntakeResult::failed(IntakeResult::LIMITED);
        }

        foreach ($this->repo->findByEmail($value['email']) as $earlier) {
            if ($now - $earlier->createdAt() <= self::REPEAT_WINDOW && $earlier->description() === $value['description'] && $earlier->name() === $value['name'] && $earlier->quantity() === $value['quantity']) {
                return IntakeResult::received($earlier->ref(), true);
            }
        }

        $inspected = ImagePolicy::inspect($body->files ?? null);
        if (!$inspected['ok']) {
            return IntakeResult::failed(IntakeResult::INVALID_FILE);
        }
        $pictures = [];
        foreach ($inspected['images'] as $image) {
            $clean = $this->sanitizer->sanitize($image);
            if ($clean === null) {
                return IntakeResult::failed(IntakeResult::INVALID_FILE);
            }
            $pictures[] = $clean;
        }

        $quote = null;
        for ($attempt = 0; $attempt < 8 && $quote === null; $attempt++) {
            try {
                $quote = $this->repo->create([
                    'ref' => Reference::generate($now),
                    'status' => Status::NEW,
                    'created_at' => $now,
                    'updated_at' => $now,
                    'name' => $value['name'],
                    'email' => $value['email'],
                    'project_type' => $value['projectType'],
                    'game' => $value['game'],
                    'description' => $value['description'],
                    'dimensions' => $value['dimensions'],
                    'quantity' => $value['quantity'],
                    'colors' => $value['colors'],
                    'deadline' => $value['deadline'],
                    'ship_to' => $value['shipTo'],
                    'client_hash' => $clientKey,
                ]);
            } catch (RefTaken) {
                // Another request took that number a moment ago: draw another.
            } catch (\Throwable) {
                return IntakeResult::failed(IntakeResult::ERROR);
            }
        }
        if ($quote === null) {
            return IntakeResult::failed(IntakeResult::ERROR);
        }
        $this->repo->addEvent($quote->id(), 'customer', 'submitted', 'Request received.', $now);

        $stored = 0;
        foreach ($pictures as $picture) {
            $storedName = bin2hex(random_bytes(20));
            try {
                $this->files->put($storedName, $picture->bytes);
                $this->repo->addFile($quote->id(), $storedName, $picture->name, $picture->mime, strlen($picture->bytes), $now);
                $stored++;
            } catch (\Throwable) {
                $this->files->delete($storedName);
                $this->flag($quote->id(), 'A reference picture could not be saved. Ask the customer to send it again.', $now);
            }
        }

        if (!$this->mailer->send($this->emails->requestReceived($quote))) {
            $this->flag($quote->id(), 'The confirmation email to the customer could not be sent.', $now);
        }
        if (!$this->mailer->send($this->emails->requestReceivedOwner($quote, $stored, ($this->adminUrl)($quote->id())))) {
            $this->flag($quote->id(), 'The notification email to ' . $this->settings->notifyEmail . ' could not be sent.', $now);
        }
        return IntakeResult::received($quote->ref());
    }

    private function flag(int $id, string $reason, int $now): void
    {
        $this->repo->swap($id, [], ['attention' => 1, 'attention_reason' => $reason], [], $now);
        $this->repo->addEvent($id, 'system', 'attention', $reason, $now);
    }
}
