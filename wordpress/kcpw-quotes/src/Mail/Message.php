<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Mail;

/** One plain-text email. Subject and addresses are single-line by construction (see Emails::oneLine), so a customer's words cannot add a header. */
final class Message
{
    public function __construct(
        public readonly string $to,
        public readonly string $subject,
        public readonly string $body,
        public readonly string $replyTo = '',
    ) {
    }
}
