<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Mail;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\QuoteInput;
use KcPrintworks\Quotes\Service\Settings;
use KcPrintworks\Quotes\Support\Money;

/**
 * The words of every email the plugin sends, as plain text (no HTML to get wrong, nothing to inject into). What a customer typed only ever
 * appears as text in the body, never in a header; subjects and names go through oneLine().
 */
final class Emails
{
    public function __construct(private readonly Settings $settings)
    {
    }

    public static function oneLine(string $text, int $max = 120): string
    {
        $text = (string) preg_replace('/[\p{C}\s]+/u', ' ', $text);
        return trim(mb_substr($text, 0, $max, 'UTF-8'));
    }

    private function firstName(Quote $quote): string
    {
        $first = explode(' ', self::oneLine($quote->name(), 80))[0];
        return $first !== '' ? $first : 'there';
    }

    private function sign(): string
    {
        return "\n" . $this->settings->shopName . "\n" . $this->settings->notifyEmail . "\n";
    }

    /** @return list<string> the request, as readable lines */
    private function requestLines(Quote $quote): array
    {
        $lines = [
            'Project: ' . (QuoteInput::PROJECT_TYPES[$quote->projectType()] ?? $quote->projectType()),
        ];
        foreach ([['Game or theme', $quote->game()], ['Dimensions', $quote->dimensions()], ['Colors', $quote->colors()]] as [$label, $value]) {
            if ($value !== '') {
                $lines[] = $label . ': ' . $value;
            }
        }
        $lines[] = 'Quantity: ' . $quote->quantity();
        if ($quote->deadline() !== '') {
            $lines[] = 'Needed by: ' . $quote->deadline();
        }
        if ($quote->shipTo() !== '') {
            $lines[] = 'Ships to: ' . $quote->shipTo();
        }
        $lines[] = '';
        $lines[] = 'Description:';
        $lines[] = $quote->description();
        return $lines;
    }

    public function requestReceived(Quote $quote): Message
    {
        $body = 'Hi ' . $this->firstName($quote) . ",\n\n"
            . "Thank you for your request. We have it, and we will email you a quote with the price, shipping and how long it is valid. You do not pay anything until you approve a quote.\n\n"
            . 'Your reference number: ' . $quote->ref() . "\n\n"
            . "What you asked for:\n" . implode("\n", $this->requestLines($quote)) . "\n\n"
            . "If anything is missing, just reply to this email and mention your reference number.\n" . $this->sign();
        return new Message($quote->email(), 'We received your custom quote request ' . $quote->ref(), $body, $this->settings->notifyEmail);
    }

    public function requestReceivedOwner(Quote $quote, int $pictures, string $adminUrl): Message
    {
        $body = 'New custom quote request ' . $quote->ref() . "\n\n"
            . 'From: ' . self::oneLine($quote->name()) . ' <' . $quote->email() . ">\n"
            . implode("\n", $this->requestLines($quote)) . "\n\n"
            . 'Pictures attached: ' . $pictures . "\n\n"
            . "Open it in the dashboard:\n" . $adminUrl . "\n\n"
            . "Replying to this email writes to the customer.\n";
        return new Message($this->settings->notifyEmail, 'New custom quote request ' . $quote->ref() . ' from ' . self::oneLine($quote->name(), 60), $body, $quote->email());
    }

    public function quoteSent(Quote $quote, string $token): Message
    {
        $currency = $quote->currency();
        $lines = [
            'Item: ' . Money::display($quote->itemCents(), $currency),
            'Shipping: ' . ($quote->shipCents() > 0 ? Money::display($quote->shipCents(), $currency) : 'Free'),
            'Total: ' . Money::display($quote->totalCents(), $currency) . ($quote->taxable() ? ' plus sales tax where it applies, added at payment' : ''),
        ];
        $body = 'Hi ' . $this->firstName($quote) . ",\n\n"
            . 'Here is your quote for ' . $quote->title() . ' (reference ' . $quote->ref() . ").\n\n"
            . implode("\n", $lines) . "\n"
            . 'This quote is valid until ' . $this->settings->longDate($quote->expiresAt()) . ".\n"
            . ($quote->details() !== '' ? "\nDetails:\n" . $quote->details() . "\n" : '')
            . "\nTo look it over and approve it, open your private link:\n" . $this->settings->quoteLink($quote->ref(), $token) . "\n\n"
            . "After you approve it you will pay securely, and we will start making it. You pay nothing until then.\n"
            . "The link is just for you: please do not share it. If you did not ask for this quote, you can ignore this email.\n"
            . "Questions? Reply to this email and mention " . $quote->ref() . ".\n" . $this->sign();
        return new Message($quote->email(), 'Your KCPrintWorks quote ' . $quote->ref() . ': ' . self::oneLine($quote->title(), 70), $body, $this->settings->notifyEmail);
    }

    public function approvedOwner(Quote $quote, int $orderId, string $adminUrl, string $orderUrl): Message
    {
        $body = 'Quote ' . $quote->ref() . ' (' . $quote->title() . ') was approved by ' . self::oneLine($quote->name()) . ".\n"
            . 'Total: ' . Money::display($quote->totalCents(), $quote->currency()) . "\n"
            . 'A pending WooCommerce order #' . $orderId . " was made and is waiting for payment.\n"
            . 'They have until ' . $this->settings->longDate($quote->payBy()) . " to pay.\n\n"
            . "Quote:\n" . $adminUrl . "\n" . ($orderUrl !== '' ? "Order:\n" . $orderUrl . "\n" : '');
        return new Message($this->settings->notifyEmail, 'Quote ' . $quote->ref() . ' approved: waiting for payment', $body, $quote->email());
    }

    public function paidOwner(Quote $quote, int $orderId, string $adminUrl): Message
    {
        $body = 'Quote ' . $quote->ref() . ' (' . $quote->title() . ') has been paid by ' . self::oneLine($quote->name()) . ".\n"
            . 'Order #' . $orderId . ', total ' . Money::display($quote->totalCents(), $quote->currency()) . ".\n\n"
            . "Next: make it, then set the quote to In Production and Completed.\n" . $adminUrl . "\n";
        return new Message($this->settings->notifyEmail, 'Quote ' . $quote->ref() . ' paid: ready to make', $body, $quote->email());
    }

    public function needsAttentionOwner(Quote $quote, string $reason, string $adminUrl): Message
    {
        $body = 'Quote ' . $quote->ref() . " needs a look:\n\n" . $reason . "\n\n" . $adminUrl . "\n";
        return new Message($this->settings->notifyEmail, 'Quote ' . $quote->ref() . ' needs your attention', $body);
    }

    public function custom(Quote $quote, string $subject, string $text): Message
    {
        $body = 'Hi ' . $this->firstName($quote) . ",\n\n" . $text . "\n\nReference: " . $quote->ref() . "\n" . $this->sign();
        return new Message($quote->email(), self::oneLine($subject, 150), $body, $this->settings->notifyEmail);
    }
}
