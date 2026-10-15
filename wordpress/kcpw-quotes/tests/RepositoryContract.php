<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Repo\QuoteQuery;
use KcPrintworks\Quotes\Repo\QuoteRepository;
use KcPrintworks\Quotes\Repo\RefTaken;

/**
 * What every QuoteRepository must do. The in-memory store and the database store (on a SQLite stand-in for $wpdb) both run these, so the
 * workflow tests, which use the memory store, are tests of behavior the real store has too.
 */
trait RepositoryContract
{
    abstract protected function repo(): QuoteRepository;

    /** @param array<string,mixed> $over */
    private function make(QuoteRepository $repo, array $over = []): \KcPrintworks\Quotes\Domain\Quote
    {
        static $n = 0;
        $n++;
        return $repo->create($over + [
            'ref' => sprintf('KCQ-2610-AAAA%02d', $n),
            'status' => Status::NEW,
            'created_at' => 1_800_000_000 + $n,
            'updated_at' => 1_800_000_000 + $n,
            'name' => 'Robin Hood',
            'email' => 'robin@example.com',
            'project_type' => 'game-case',
            'description' => 'A case for the game with room for sleeves.',
            'quantity' => 2,
        ]);
    }

    public function testCreateFillsEverythingAndFindsItAgainByIdAndReference(): void
    {
        $repo = $this->repo();
        $quote = $this->make($repo, ['game' => 'Catan', 'ship_to' => 'US 48503']);
        $this->assertTrue($quote->id() > 0);
        $this->assertSame(Status::NEW, $quote->status());
        $this->assertSame('Catan', $quote->game());
        $this->assertSame(0, $quote->itemCents());
        $this->assertSame('', $quote->tokenHash());
        $this->assertSame(0, $quote->orderId());
        $this->assertFalse($quote->needsAttention());
        $this->assertSame($quote->toRow(), $repo->find($quote->id())?->toRow());
        $this->assertSame($quote->id(), $repo->findByRef($quote->ref())?->id());
        $this->assertNull($repo->find(999_999));
        $this->assertNull($repo->findByRef('KCQ-0000-ZZZZZZ'));
    }

    public function testTextSurvivesExactlyIncludingUnicodeQuotesAndNewlines(): void
    {
        $repo = $this->repo();
        $text = "Line one with 'quotes' and \"double\" and a backslash \\ and a percent %s %d\nLine two: Ünïcödé 日本語 😀 <b>bold</b>";
        $quote = $this->make($repo, ['description' => $text, 'name' => "Zoë O'Brien"]);
        $found = $repo->find($quote->id());
        $this->assertSame($text, $found?->description());
        $this->assertSame("Zoë O'Brien", $found?->name());
    }

    public function testAReferenceCanOnlyBeUsedOnce(): void
    {
        $repo = $this->repo();
        $this->make($repo, ['ref' => 'KCQ-2610-DUPLIC']);
        $this->assertThrows(RefTaken::class, fn () => $this->make($repo, ['ref' => 'KCQ-2610-DUPLIC']));
    }

    public function testAColumnThatDoesNotExistIsRefused(): void
    {
        $this->assertThrows(\InvalidArgumentException::class, fn () => $this->make($this->repo(), ['price' => 5]));
    }

    public function testSwapChangesTheQuoteOnlyFromTheExpectedStatus(): void
    {
        $repo = $this->repo();
        $quote = $this->make($repo);
        $this->assertFalse($repo->swap($quote->id(), [Status::QUOTED], ['status' => Status::APPROVED], [], 1_800_000_100), 'wrong starting status');
        $this->assertSame(Status::NEW, $repo->find($quote->id())?->status());
        $this->assertTrue($repo->swap($quote->id(), [Status::NEW, Status::REVIEWING], ['status' => Status::REVIEWING], [], 1_800_000_100));
        $after = $repo->find($quote->id());
        $this->assertSame(Status::REVIEWING, $after?->status());
        $this->assertSame(1_800_000_100, $after?->updatedAt());
        $this->assertFalse($repo->swap(424242, [], ['status' => Status::REVIEWING], [], 1), 'a quote that does not exist');
    }

    public function testTwoCompetingSwapsFromTheSameStateOnlyOneWins(): void
    {
        $repo = $this->repo();
        $quote = $this->make($repo, ['status' => Status::QUOTED]);
        $first = $repo->swap($quote->id(), [Status::QUOTED], ['status' => Status::APPROVED, 'approved_at' => 5], [], 10);
        $second = $repo->swap($quote->id(), [Status::QUOTED], ['status' => Status::APPROVED, 'approved_at' => 6], [], 11);
        $this->assertTrue($first);
        $this->assertFalse($second);
        $this->assertSame(5, $repo->find($quote->id())?->approvedAt());
    }

    public function testSwapCanAlsoRequireColumnsToStillHaveTheValuesTheCallerSaw(): void
    {
        $repo = $this->repo();
        $quote = $this->make($repo, ['status' => Status::QUOTED, 'revision' => 2]);
        $this->assertFalse($repo->swap($quote->id(), [Status::QUOTED], ['status' => Status::APPROVED], ['revision' => 1], 10), 'an older revision');
        $this->assertTrue($repo->swap($quote->id(), [Status::QUOTED], ['status' => Status::APPROVED], ['revision' => 2], 10));
        // An empty guard string matches an empty column, which is how "no order yet" is written.
        $this->assertFalse($repo->swap($quote->id(), [], ['order_lease' => 'a'], ['order_lease' => 'zzz'], 11));
        $this->assertTrue($repo->swap($quote->id(), [], ['order_lease' => 'a'], ['order_lease' => '', 'order_id' => 0], 11));
        $this->assertFalse($repo->swap($quote->id(), [], ['order_lease' => 'b'], ['order_lease' => '', 'order_id' => 0], 12), 'the lease is taken');
    }

    public function testNumbersComeBackAsNumbersAndFlagsAsFlags(): void
    {
        $repo = $this->repo();
        $quote = $this->make($repo);
        $repo->swap($quote->id(), [], ['item_cents' => 4500, 'ship_cents' => 850, 'taxable' => 1, 'attention' => 1, 'attention_reason' => 'check', 'currency' => 'USD', 'revision' => 3, 'expires_at' => 1_900_000_000], [], 20);
        $found = $repo->find($quote->id());
        $this->assertSame(4500, $found?->itemCents());
        $this->assertSame(5350, $found?->totalCents());
        $this->assertTrue($found?->taxable());
        $this->assertTrue($found?->needsAttention());
        $this->assertSame('check', $found?->attentionReason());
        $this->assertSame(3, $found?->revision());
        $this->assertSame(1_900_000_000, $found?->expiresAt());
    }

    public function testFindByOrderIdAndByEmail(): void
    {
        $repo = $this->repo();
        $a = $this->make($repo, ['email' => 'pat@example.com']);
        $b = $this->make($repo, ['email' => 'pat@example.com']);
        $this->make($repo, ['email' => 'other@example.com']);
        $repo->swap($b->id(), [], ['order_id' => 77], [], 30);
        $this->assertSame($b->id(), $repo->findByOrderId(77)?->id());
        $this->assertNull($repo->findByOrderId(78));
        $this->assertNull($repo->findByOrderId(0));
        $mine = $repo->findByEmail('PAT@example.com');
        $this->assertSame([$b->id(), $a->id()], array_map(static fn ($q): int => $q->id(), $mine), 'newest first');
    }

    public function testCountsCoverEveryStatusEvenWhenEmpty(): void
    {
        $repo = $this->repo();
        $this->make($repo);
        $this->make($repo, ['status' => Status::QUOTED]);
        $this->make($repo, ['status' => Status::QUOTED]);
        $counts = $repo->counts();
        $this->assertSame(Status::all(), array_keys($counts));
        $this->assertSame(1, $counts[Status::NEW]);
        $this->assertSame(2, $counts[Status::QUOTED]);
        $this->assertSame(0, $counts[Status::PAID]);
    }

    public function testCountSinceCountsAllOrOnlyOneVisitor(): void
    {
        $repo = $this->repo();
        $this->make($repo, ['created_at' => 1000, 'client_hash' => str_repeat('a', 64)]);
        $this->make($repo, ['created_at' => 2000, 'client_hash' => str_repeat('a', 64)]);
        $this->make($repo, ['created_at' => 2000, 'client_hash' => str_repeat('b', 64)]);
        $this->assertSame(3, $repo->countSince(0));
        $this->assertSame(2, $repo->countSince(1500));
        $this->assertSame(1, $repo->countSince(1500, str_repeat('a', 64)));
        $this->assertSame(2, $repo->countSince(0, str_repeat('a', 64)));
    }

    public function testDueForExpiryFindsOnlyOffersAndPaymentWindowsThatRanOut(): void
    {
        $repo = $this->repo();
        $late = $this->make($repo, ['status' => Status::QUOTED, 'expires_at' => 1000]);
        $this->make($repo, ['status' => Status::QUOTED, 'expires_at' => 5000]);
        $unpaid = $this->make($repo, ['status' => Status::APPROVED, 'pay_by' => 900, 'expires_at' => 100]);
        $this->make($repo, ['status' => Status::APPROVED, 'pay_by' => 9000]);
        $this->make($repo, ['status' => Status::PAID, 'pay_by' => 10, 'expires_at' => 10]);
        $this->make($repo, ['status' => Status::NEW, 'expires_at' => 10]);
        $due = $repo->dueForExpiry(2000, 50);
        $this->assertSame([$late->id(), $unpaid->id()], array_map(static fn ($q): int => $q->id(), $due));
        $this->assertCount(1, $repo->dueForExpiry(2000, 1), 'the limit applies');
    }

    public function testPicturesNotesAndHistoryAreKeptPerQuoteInOrder(): void
    {
        $repo = $this->repo();
        $one = $this->make($repo);
        $two = $this->make($repo);
        $file = $repo->addFile($one->id(), str_repeat('c', 40), 'my logo.png', 'image/png', 1234, 50);
        $repo->addFile($two->id(), str_repeat('d', 40), 'other.jpg', 'image/jpeg', 99, 51);
        $this->assertCount(1, $repo->files($one->id()));
        $this->assertSame('my logo.png', $repo->files($one->id())[0]->displayName);
        $this->assertSame($file->storedName, $repo->file($file->id)?->storedName);
        $this->assertNull($repo->file(31337));

        $repo->addNote($one->id(), 7, 'Kim', 'Call about the lid', 60);
        $repo->addNote($one->id(), 7, 'Kim', "Second note: it's 100% fine", 61);
        $notes = $repo->notes($one->id());
        $this->assertSame(['Call about the lid', "Second note: it's 100% fine"], array_map(static fn ($n): string => $n->note, $notes));
        $this->assertSame([], $repo->notes($two->id()));

        $repo->addEvent($one->id(), 'customer', 'submitted', 'Request received', 70);
        $repo->addEvent($one->id(), 'admin:7', 'status', 'New to Reviewing', 71);
        $events = $repo->events($one->id());
        $this->assertSame(['submitted', 'status'], array_map(static fn ($e): string => $e->kind, $events));
        $this->assertSame('admin:7', $events[1]->actor);

        $this->assertSame(2, $repo->eraseNotes($one->id()));
        $this->assertSame(['[erased]', '[erased]'], array_map(static fn ($n): string => $n->note, $repo->notes($one->id())));
        $this->assertSame(0, $repo->eraseNotes($two->id()));

        $gone = $repo->removeFiles($one->id());
        $this->assertCount(1, $gone);
        $this->assertSame([], $repo->files($one->id()));
        $this->assertCount(1, $repo->files($two->id()));
    }

    public function testSearchFiltersByStatusAndAllWordsAndPagesNewestFirst(): void
    {
        $repo = $this->repo();
        $a = $this->make($repo, ['name' => 'Alice Archer', 'game' => 'Catan', 'created_at' => 1000]);
        $b = $this->make($repo, ['name' => 'Bob Baker', 'game' => 'Catan Seafarers', 'status' => Status::QUOTED, 'created_at' => 2000, 'quote_title' => 'Two tone case']);
        $c = $this->make($repo, ['name' => 'Cy Carter', 'email' => 'cy@example.org', 'game' => 'Wingspan', 'attention' => 1, 'created_at' => 3000]);

        $all = $repo->search(new QuoteQuery());
        $this->assertSame([$c->id(), $b->id(), $a->id()], array_map(static fn ($q): int => $q->id(), $all->items));
        $this->assertSame(3, $all->total);

        $this->assertSame([$b->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(status: Status::QUOTED))->items));
        $this->assertSame([$b->id(), $a->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: 'catan'))->items));
        $this->assertSame([$b->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: 'CATAN  seafarers'))->items), 'every word must match');
        $this->assertSame([$b->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: 'two tone'))->items), 'the quote title is searched');
        $this->assertSame([$c->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: 'cy@example'))->items), 'email');
        $this->assertSame([$c->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: $c->ref()))->items), 'reference');
        $this->assertSame([$c->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(attentionOnly: true))->items));
        $this->assertSame([], $repo->search(new QuoteQuery(search: 'nothing like this'))->items);

        $page2 = $repo->search(new QuoteQuery(page: 2, perPage: 2));
        $this->assertSame([$a->id()], array_map(static fn ($q): int => $q->id(), $page2->items));
        $this->assertSame(3, $page2->total);
        $this->assertSame(2, $page2->pages());
    }

    public function testSearchTreatsPercentAndUnderscoreAsPlainCharacters(): void
    {
        $repo = $this->repo();
        $this->make($repo, ['name' => 'Plain Person', 'description' => 'A normal request for a case, thanks a lot.']);
        $pct = $this->make($repo, ['name' => 'Percent Person', 'description' => 'I need 100% of them to be 50_50 black and white.']);
        $this->assertSame([$pct->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: '100%'))->items));
        $this->assertSame([$pct->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: '50_50'))->items));
        $this->assertSame([$pct->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: '%'))->items), 'a lone % finds the percent sign, not everything');
        $this->assertSame([$pct->id()], array_map(static fn ($q): int => $q->id(), $repo->search(new QuoteQuery(search: '_'))->items), 'a lone _ finds the underscore, not every letter');
    }
}
