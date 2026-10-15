<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Mail;

final class MemoryMailer implements Mailer
{
    /** @var list<Message> */
    public array $sent = [];
    public bool $fail = false;
    /** @var list<string> addresses that fail (the rest succeed) */
    public array $failFor = [];

    public function send(Message $message): bool
    {
        if ($this->fail || in_array($message->to, $this->failFor, true)) {
            return false;
        }
        $this->sent[] = $message;
        return true;
    }

    /** @return list<Message> */
    public function to(string $address): array
    {
        return array_values(array_filter($this->sent, static fn (Message $m): bool => $m->to === $address));
    }
}
