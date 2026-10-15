<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Service\Privacy;

final class PrivacyTest extends TestCase
{
    public function testExportListsWhatWeHoldAboutAnEmailAddressAndNothingAboutOthers(): void
    {
        $f = new Fixtures();
        $mine = $f->newQuote(['email' => 'me@example.com']);
        $f->repo->addNote($mine->id(), 7, 'Kim', 'Prefers phone calls', $f->time);
        $f->repo->addFile($mine->id(), str_repeat('a', 40), 'my logo.png', 'image/png', 10, $f->time);
        $f->newQuote(['email' => 'other@example.com']);
        $groups = (new Privacy($f->context()))->export('ME@example.com');
        $this->assertCount(1, $groups);
        $this->assertStringContains($mine->ref(), $groups[0]['label']);
        $names = array_column($groups[0]['data'], 'name');
        foreach (['Reference', 'Name', 'Email', 'Description', 'Picture', 'Note kept by the shop'] as $needed) {
            $this->assertContains($needed, $names);
        }
        $this->assertSame([], (new Privacy($f->context()))->export('nobody@example.com'));
    }

    public function testErasingRemovesPersonalDetailsPicturesAndNotesButKeepsTheRecord(): void
    {
        $f = new Fixtures();
        $result = $f->intake()->submit(Fixtures::body(['email' => 'me@example.com'], [Fixtures::picture()]));
        $quote = $f->repo->findByRef((string) $result->ref);
        $f->repo->addNote($quote->id(), 7, 'Kim', 'He lives at 5 Elm St', $f->time);
        $f->repo->swap($quote->id(), [], ['status' => Status::COMPLETED, 'item_cents' => 4500, 'ship_cents' => 850, 'currency' => 'USD', 'revision' => 1], [], $f->time);
        $stored = $f->repo->files($quote->id())[0]->storedName;
        $this->assertTrue($f->files->read($stored) !== null);

        $outcome = (new Privacy($f->context()))->erase('me@example.com');
        $this->assertSame(1, $outcome['removed']);
        $this->assertSame(0, $outcome['retained']);
        $after = $f->repo->find($quote->id());
        $this->assertTrue($after?->erased());
        $this->assertSame('Erased', $after?->name());
        $this->assertSame('', $after?->email());
        $this->assertSame('', $after?->description());
        $this->assertSame('', $after?->shipTo());
        $this->assertSame('', $after?->clientHash());
        $this->assertSame($quote->ref(), $after?->ref(), 'the reference stays');
        $this->assertSame(5350, $after?->totalCents(), 'the amounts stay');
        $this->assertSame([], $f->repo->files($quote->id()));
        $this->assertNull($f->files->read($stored), 'the file is gone from disk');
        $this->assertSame('[erased]', $f->repo->notes($quote->id())[0]->note);
        $this->assertSame([], (new Privacy($f->context()))->export('me@example.com'));
        $this->assertSame(0, (new Privacy($f->context()))->erase('me@example.com')['removed'], 'a second run finds nothing');
    }

    public function testAQuoteThatIsStillLiveIsNotErased(): void
    {
        foreach ([Status::QUOTED, Status::APPROVED, Status::PAID, Status::IN_PRODUCTION] as $live) {
            $f = new Fixtures();
            $quote = $f->newQuote(['email' => 'me@example.com']);
            $f->repo->swap($quote->id(), [], ['status' => $live], [], $f->time);
            $outcome = (new Privacy($f->context()))->erase('me@example.com');
            $this->assertSame(0, $outcome['removed'], $live);
            $this->assertSame(1, $outcome['retained'], $live);
            $this->assertStringContains($quote->ref(), $outcome['messages'][0]);
            $this->assertFalse($f->repo->find($quote->id())?->erased());
        }
    }

    public function testAnErasedCustomerCannotBeEmailed(): void
    {
        $f = new Fixtures();
        $quote = $f->newQuote(['email' => 'me@example.com']);
        (new Privacy($f->context()))->erase('me@example.com');
        $this->assertSame('erased', $f->admin()->emailCustomer($quote->id(), 'Hello there', 'Hi', 'a')->code);
        $this->assertSame([], $f->mailer->sent);
    }
}
