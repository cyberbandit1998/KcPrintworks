<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Mail;

interface Mailer
{
    /** True when the message was handed to the mail system (that does not prove it was delivered). */
    public function send(Message $message): bool;
}
