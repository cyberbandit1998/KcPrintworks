<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Reference;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Service\IntakeResult;
use KcPrintworks\Quotes\Support\Json;

final class IntakeTest extends TestCase
{
    public function testAGoodRequestIsSavedAsNewWithAReferenceAndTwoEmails(): void
    {
        $f = new Fixtures();
        $result = $f->intake()->submit(Fixtures::body());
        $this->assertTrue($result->ok());
        $this->assertSame(200, $result->httpStatus());
        $this->assertTrue(Reference::valid((string) $result->ref), (string) $result->ref);
        $quote = $f->repo->findByRef((string) $result->ref);
        $this->assertSame(Status::NEW, $quote?->status());
        $this->assertSame('Robin Hood', $quote?->name());
        $this->assertSame('robin@example.com', $quote?->email());
        $this->assertSame(2, $quote?->quantity());
        $this->assertSame(0, $quote?->itemCents(), 'a request has no price');
        $this->assertSame('', $quote?->tokenHash(), 'and no link');
        $this->assertSame(str_repeat('a', 64), $quote?->clientHash());

        $toCustomer = $f->mailer->to('robin@example.com');
        $this->assertCount(1, $toCustomer);
        $this->assertStringContains((string) $result->ref, $toCustomer[0]->subject);
        $this->assertStringContains('You do not pay anything until you approve a quote', $toCustomer[0]->body);
        $toOwner = $f->mailer->to('contact@kcprintworks.com');
        $this->assertCount(1, $toOwner);
        $this->assertSame('robin@example.com', $toOwner[0]->replyTo, 'replying writes to the customer');
        $this->assertStringContains('admin.php?page=kcpw-quotes&quote=' . $quote?->id(), $toOwner[0]->body);
        $this->assertStringContains('A case for the base game', $toOwner[0]->body);
        $kinds = array_map(static fn ($e): string => $e->kind, $f->repo->events((int) $quote?->id()));
        $this->assertSame(['submitted'], $kinds);
    }

    public function testNothingThatLooksLikeAPriceStatusOrOrderGetsIn(): void
    {
        $f = new Fixtures();
        foreach (['price' => 1, 'total' => 5, 'status' => 'paid', 'orderId' => 7, 'itemCents' => 1, 'ref' => 'KCQ-2610-HACKED', 'tokenHash' => 'x'] as $field => $value) {
            $body = Fixtures::body([$field => $value]);
            $result = $f->intake()->submit($body);
            $this->assertSame(IntakeResult::INVALID, $result->status, $field);
            $this->assertSame($field, $result->problems[0]['field']);
            $this->assertSame('unknown_field', $result->problems[0]['code']);
        }
        $this->assertSame(0, $f->repo->counts()[Status::NEW], 'none of them was saved');
        $withTopLevel = Json::decode('{"request":' . json_encode(Fixtures::request()) . ',"clientKey":"' . str_repeat('a', 64) . '","status":"paid"}');
        $this->assertSame(IntakeResult::INVALID, $f->intake()->submit($withTopLevel)->status, 'a stray top-level key');
        $this->assertSame(0, $f->repo->counts()[Status::NEW]);
    }

    public function testBadInputIsRefusedWithTheProblemsAndSavesNothing(): void
    {
        $f = new Fixtures();
        $result = $f->intake()->submit(Fixtures::body(['email' => 'nope', 'description' => 'short']));
        $this->assertSame(IntakeResult::INVALID, $result->status);
        $this->assertSame(400, $result->httpStatus());
        $this->assertSame(['email', 'description'], array_column($result->problems, 'field'));
        $this->assertSame([], $f->mailer->sent);
        foreach ([null, 'text', [], 5] as $junk) {
            $this->assertSame(IntakeResult::INVALID, $f->intake()->submit($junk)->status);
        }
        $this->assertSame(IntakeResult::INVALID, $f->intake()->submit(Json::decode('{"request":{}}'))->status, 'no client key');
        $this->assertSame(IntakeResult::INVALID, $f->intake()->submit(Fixtures::body([], [], 'not-a-hash'))->status, 'client key must be a hash');
    }

    public function testADeadlineInThePastOrTooFarOutIsRefused(): void
    {
        $f = new Fixtures();
        $today = $f->settings->today(Fixtures::NOW);
        $past = (new \DateTimeImmutable($today))->modify('-1 day')->format('Y-m-d');
        $far = (new \DateTimeImmutable($today))->modify('+3 years')->format('Y-m-d');
        $this->assertSame('deadline', $f->intake()->submit(Fixtures::body(['deadline' => $past]))->problems[0]['field']);
        $this->assertSame('deadline', $f->intake()->submit(Fixtures::body(['deadline' => $far]))->problems[0]['field']);
        $ok = (new \DateTimeImmutable($today))->modify('+30 days')->format('Y-m-d');
        $this->assertTrue($f->intake()->submit(Fixtures::body(['deadline' => $ok]))->ok());
    }

    public function testTooManyFromOneVisitorOrTooManyOverallAreRefused(): void
    {
        $f = new Fixtures();
        for ($i = 0; $i < $f->settings->maxPerClientPerHour; $i++) {
            $this->assertTrue($f->intake()->submit(Fixtures::body(['description' => 'Request number ' . $i . ' for a different case, thanks.']))->ok(), "request $i");
        }
        $limited = $f->intake()->submit(Fixtures::body(['description' => 'One request too many from the same visitor.']));
        $this->assertSame(IntakeResult::LIMITED, $limited->status);
        $this->assertSame(429, $limited->httpStatus());
        $other = $f->intake()->submit(Fixtures::body(['description' => 'A different visitor is not affected at all.'], [], str_repeat('b', 64)));
        $this->assertTrue($other->ok(), 'another visitor');

        $f->time += 3601;
        $this->assertTrue($f->intake()->submit(Fixtures::body(['description' => 'An hour later the same visitor may ask again.']))->ok());

        $busy = new Fixtures(new \KcPrintworks\Quotes\Service\Settings(Fixtures::SECRET, 'https://kcprintworks.com', maxPerClientPerHour: 100, maxAllPerHour: 3));
        for ($i = 0; $i < 3; $i++) {
            $this->assertTrue($busy->intake()->submit(Fixtures::body(['description' => 'Request ' . $i . ' on a busy day for the shop.'], [], str_repeat(dechex($i), 64)))->ok());
        }
        $this->assertSame(IntakeResult::LIMITED, $busy->intake()->submit(Fixtures::body(['description' => 'The shop-wide cap is reached now.'], [], str_repeat('f', 64)))->status);
    }

    public function testTheSameRequestSentTwiceMakesOneQuoteAndOneSetOfEmails(): void
    {
        $f = new Fixtures();
        $first = $f->intake()->submit(Fixtures::body());
        $f->time += 30;
        $second = $f->intake()->submit(Fixtures::body());
        $this->assertTrue($second->ok());
        $this->assertSame($first->ref, $second->ref);
        $this->assertSame(1, $f->repo->counts()[Status::NEW]);
        $this->assertCount(2, $f->mailer->sent, 'the customer and the owner, once');
        $f->time += 700;
        $third = $f->intake()->submit(Fixtures::body());
        $this->assertTrue($third->ok());
        $this->assertTrue($third->ref !== $first->ref, 'a request after the repeat window is a new one');
    }

    public function testPicturesAreCheckedRedrawnAndStoredUnderRandomNamesWithNoExtension(): void
    {
        $f = new Fixtures();
        $result = $f->intake()->submit(Fixtures::body([], [Fixtures::picture('image/png', 'My Logo (final).PNG'), Fixtures::picture('image/jpeg', '../../etc/passwd.jpg')]));
        $this->assertTrue($result->ok());
        $quote = $f->repo->findByRef((string) $result->ref);
        $files = $f->repo->files((int) $quote?->id());
        $this->assertCount(2, $files);
        $this->assertSame(['My Logo (final).png', 'passwd.jpg'], array_map(static fn ($x): string => $x->displayName, $files));
        foreach ($files as $file) {
            $this->assertSame(1, preg_match('/^[0-9a-f]{40}$/', $file->storedName), 'a random name, no path, no extension');
            $this->assertTrue($f->files->read($file->storedName) !== null);
            $this->assertTrue($file->bytes > 0);
        }
        $this->assertStringContains('Pictures attached: 2', $f->mailer->to('contact@kcprintworks.com')[0]->body);
    }

    public function testABadPictureRefusesTheWholeRequestBeforeAnythingIsSaved(): void
    {
        $f = new Fixtures();
        $bad = ['name' => 'evil.png', 'type' => 'image/png', 'data' => base64_encode("<?php system('id'); ?>")];
        $result = $f->intake()->submit(Fixtures::body([], [Fixtures::picture(), $bad]));
        $this->assertSame(IntakeResult::INVALID_FILE, $result->status);
        $this->assertSame(400, $result->httpStatus());
        $this->assertSame(0, $f->repo->counts()[Status::NEW]);
        $this->assertSame([], $f->files->files);
        $this->assertSame([], $f->mailer->sent);
    }

    public function testAPictureThatCannotBeSavedDoesNotLoseTheRequestButFlagsIt(): void
    {
        $f = new Fixtures();
        $f->files->failNextPut = true;
        $result = $f->intake()->submit(Fixtures::body([], [Fixtures::picture()]));
        $this->assertTrue($result->ok());
        $quote = $f->repo->findByRef((string) $result->ref);
        $this->assertTrue($quote?->needsAttention());
        $this->assertStringContains('picture could not be saved', (string) $quote?->attentionReason());
        $this->assertSame([], $f->repo->files((int) $quote?->id()));
    }

    public function testAnEmailThatFailsFlagsTheQuoteButTheRequestIsKept(): void
    {
        $f = new Fixtures();
        $f->mailer->failFor = ['contact@kcprintworks.com'];
        $result = $f->intake()->submit(Fixtures::body());
        $this->assertTrue($result->ok());
        $quote = $f->repo->findByRef((string) $result->ref);
        $this->assertTrue($quote?->needsAttention());
        $this->assertStringContains('contact@kcprintworks.com', (string) $quote?->attentionReason());
        $this->assertCount(1, $f->mailer->sent, 'the customer still got theirs');
        $events = array_map(static fn ($e): string => $e->kind, $f->repo->events((int) $quote?->id()));
        $this->assertContains('attention', $events);
    }

    public function testNothingPersonalLeaksIntoEmailHeaders(): void
    {
        $f = new Fixtures();
        $result = $f->intake()->submit(Fixtures::body(['name' => "Eve\r\nBcc: spy@example.com"]));
        $this->assertSame(IntakeResult::INVALID, $result->status, 'a line break in a name is refused outright');
        $ok = $f->intake()->submit(Fixtures::body(['name' => "Eve O'Neil"]));
        foreach ($f->mailer->sent as $message) {
            $this->assertSame(0, preg_match('/[\r\n]/', $message->subject), 'subject is one line');
            $this->assertSame(0, preg_match('/[\r\n]/', $message->replyTo), 'reply-to is one line');
            $this->assertSame(0, preg_match('/[\r\n]/', $message->to), 'recipient is one line');
        }
        $this->assertTrue($ok->ok());
    }
}
