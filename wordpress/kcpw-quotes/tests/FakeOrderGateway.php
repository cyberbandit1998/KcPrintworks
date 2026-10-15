<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Service\OrderFacts;
use KcPrintworks\Quotes\Service\OrderFailed;
use KcPrintworks\Quotes\Service\OrderGateway;
use KcPrintworks\Quotes\Service\OrderRef;

/** WooCommerce orders kept in an array, behaving as the real gateway is specified to. The real one is proven by the staging checklist. */
final class FakeOrderGateway implements OrderGateway
{
    public string $currency = 'USD';
    public int $decimals = 2;
    public bool $failCreate = false;
    public bool $failCancel = false;
    /** @var (callable(): void)|null runs inside createPendingOrder, to let a test change things at the worst moment */
    public $beforeCreate = null;
    public int $created = 0;
    private int $nextId = 1000;
    /** @var array<int,array<string,mixed>> */
    public array $orders = [];

    public function currency(): string
    {
        return $this->currency;
    }

    public function decimals(): int
    {
        return $this->decimals;
    }

    public function createPendingOrder(Quote $quote, array $address, string $fingerprint): OrderRef
    {
        if ($this->failCreate) {
            throw new OrderFailed('WooCommerce said no');
        }
        if ($this->beforeCreate !== null) {
            ($this->beforeCreate)();
        }
        $id = $this->nextId++;
        $this->created++;
        // A taxable quote gets 10% tax added by "WooCommerce"; a non-taxable one gets none.
        $tax = $quote->taxable() ? intdiv($quote->totalCents(), 10) : 0;
        $this->orders[$id] = [
            'status' => 'pending', 'currency' => $quote->currency(), 'fee' => $quote->itemCents(), 'shipping' => $quote->shipCents(),
            'tax' => $tax, 'other' => 0, 'quoteId' => $quote->id(), 'fp' => $fingerprint, 'closedByPlugin' => false, 'notes' => [],
            'address' => $address, 'email' => $quote->email(), 'ref' => $quote->ref(),
        ];
        return new OrderRef($id, $this->url($id));
    }

    private function url(int $id): string
    {
        return 'https://shop.example.com/checkout/order-pay/' . $id . '/?pay_for_order=true&key=wc_order_test' . $id;
    }

    public function findByQuote(int $quoteId): ?OrderRef
    {
        foreach ($this->orders as $id => $order) {
            if ($order['quoteId'] === $quoteId && $order['status'] !== 'cancelled') {
                return new OrderRef($id, $this->url($id));
            }
        }
        return null;
    }

    public function payUrl(int $orderId): ?string
    {
        return in_array($this->orders[$orderId]['status'] ?? '', ['pending', 'failed'], true) ? $this->url($orderId) : null;
    }

    public function cancelUnpaid(int $orderId, string $note): string
    {
        $order = $this->orders[$orderId] ?? null;
        if ($order === null) {
            return 'missing';
        }
        if (in_array($order['status'], ['processing', 'completed', 'refunded'], true)) {
            return 'paid';
        }
        if ($order['status'] === 'cancelled') {
            return 'already_cancelled';
        }
        if ($this->failCancel) {
            return 'failed';
        }
        $this->orders[$orderId]['status'] = 'cancelled';
        $this->orders[$orderId]['closedByPlugin'] = true;
        $this->orders[$orderId]['notes'][] = $note;
        return 'cancelled';
    }

    public function inspect(int $orderId): ?OrderFacts
    {
        $o = $this->orders[$orderId] ?? null;
        if ($o === null) {
            return null;
        }
        return new OrderFacts($orderId, $o['status'], $o['currency'], $o['fee'], $o['shipping'], $o['tax'], $o['fee'] + $o['shipping'] + $o['tax'], $o['other'], $o['quoteId'], $o['fp'], $o['closedByPlugin'], $o['method'] ?? '', $o['transaction'] ?? '');
    }

    public function note(int $orderId, string $text): void
    {
        $this->orders[$orderId]['notes'][] = $text;
    }

    public function adminUrl(int $orderId): string
    {
        return 'https://shop.example.com/wp-admin/post.php?post=' . $orderId . '&action=edit';
    }

    /** The customer paid (what the Stripe plugin does: a paid status, its method and the charge id). */
    public function pay(int $orderId, string $method = 'stripe', string $transaction = 'ch_test_123'): void
    {
        $this->orders[$orderId]['status'] = 'processing';
        $this->orders[$orderId]['method'] = $method;
        $this->orders[$orderId]['transaction'] = $transaction;
    }
}
