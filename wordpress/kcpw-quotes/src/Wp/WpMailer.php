<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Mail\Mailer;
use KcPrintworks\Quotes\Mail\Message;

/** Sends through wp_mail(), so whatever mail setup the site has (an SMTP plugin, the host's mail) is what is used. Plain text only. */
final class WpMailer implements Mailer
{
    public function send(Message $message): bool
    {
        if (is_email($message->to) === false) {
            return false;
        }
        $headers = ['Content-Type: text/plain; charset=UTF-8'];
        if ($message->replyTo !== '' && is_email($message->replyTo) !== false) {
            $headers[] = 'Reply-To: ' . $message->replyTo;
        }
        try {
            return (bool) wp_mail($message->to, $message->subject, $message->body, $headers);
        } catch (\Throwable) {
            return false;
        }
    }
}
