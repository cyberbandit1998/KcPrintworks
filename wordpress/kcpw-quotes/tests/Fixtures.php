<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Mail\Emails;
use KcPrintworks\Quotes\Mail\MemoryMailer;
use KcPrintworks\Quotes\Repo\MemoryQuoteRepository;
use KcPrintworks\Quotes\Service\Admin;
use KcPrintworks\Quotes\Service\Context;
use KcPrintworks\Quotes\Service\Customer;
use KcPrintworks\Quotes\Service\Intake;
use KcPrintworks\Quotes\Service\Payments;
use KcPrintworks\Quotes\Service\Settings;
use KcPrintworks\Quotes\Support\Json;
use KcPrintworks\Quotes\Upload\GdImageSanitizer;
use KcPrintworks\Quotes\Upload\ImageSanitizer;
use KcPrintworks\Quotes\Upload\MemoryFileStore;
use KcPrintworks\Quotes\Upload\PassThroughSanitizer;

/** One shop, assembled from the in-memory parts, with a clock a test can move. */
final class Fixtures
{
    public const SECRET = '0123456789abcdef0123456789abcdef-test-secret-not-real';
    public const NOW = 1_800_000_000;

    public int $time = self::NOW;
    public MemoryQuoteRepository $repo;
    public MemoryFileStore $files;
    public MemoryMailer $mailer;
    public Settings $settings;
    public Emails $emails;
    public ImageSanitizer $sanitizer;
    public FakeOrderGateway $orders;

    public function __construct(?Settings $settings = null)
    {
        $this->repo = new MemoryQuoteRepository();
        $this->files = new MemoryFileStore();
        $this->mailer = new MemoryMailer();
        $this->settings = $settings ?? new Settings(self::SECRET, 'https://kcprintworks.com', 'contact@kcprintworks.com', 'KCPrintWorks', 'America/Detroit');
        $this->emails = new Emails($this->settings);
        $this->sanitizer = GdImageSanitizer::available() ? new GdImageSanitizer() : new PassThroughSanitizer();
        $this->orders = new FakeOrderGateway();
    }

    public function now(): int
    {
        return $this->time;
    }

    public function adminUrl(int $id): string
    {
        return 'https://shop.example.com/wp-admin/admin.php?page=kcpw-quotes&quote=' . $id;
    }

    public function context(): Context
    {
        return new Context($this->repo, $this->orders, $this->mailer, $this->emails, $this->settings, $this->files, fn (): int => $this->time, fn (int $id): string => $this->adminUrl($id));
    }

    public function admin(): Admin
    {
        return new Admin($this->context());
    }

    public function payments(): Payments
    {
        return new Payments($this->context());
    }

    public function customer(): Customer
    {
        return new Customer($this->context(), $this->payments());
    }

    /** A valid offer as OfferInput returns it. @return array{title:string,details:string,itemCents:int,shipCents:int,expiresAt:int} */
    public function offer(int $item = 4500, int $ship = 850, ?int $days = null): array
    {
        return ['title' => 'Custom case for Catan, two-tone', 'details' => "Printed in PETG, black body with an orange lid.\nReady in about two weeks.", 'itemCents' => $item, 'shipCents' => $ship, 'expiresAt' => $this->time + ($days ?? 14) * 86400];
    }

    /** A request that has been submitted. */
    public function newQuote(array $request = []): \KcPrintworks\Quotes\Domain\Quote
    {
        static $serial = 0;
        $serial++;
        // Each one is a different request (the same words twice in ten minutes would be taken for a double click).
        $request += ['description' => 'A case for the base game and both expansions, with room for the sleeves. Request ' . $serial . '.'];
        $result = $this->intake()->submit(self::body($request, [], bin2hex(random_bytes(32))));
        $quote = $this->repo->findByRef((string) $result->ref);
        if ($quote === null) {
            throw new \RuntimeException('the request was not saved');
        }
        $this->mailer->sent = [];
        return $quote;
    }

    /**
     * A quote that has been sent: returns the quote and the secret token the customer's email contained (read from the email, as a
     * customer would).
     *
     * @return array{0:\KcPrintworks\Quotes\Domain\Quote,1:string}
     */
    public function sentQuote(?array $offer = null): array
    {
        $quote = $this->newQuote();
        $outcome = $this->admin()->sendQuote($quote->id(), $offer ?? $this->offer(), 'admin:7');
        if (!$outcome->ok) {
            throw new \RuntimeException('could not send: ' . $outcome->message);
        }
        return [$this->repo->find($quote->id()), $this->lastToken()];
    }

    public function lastToken(): string
    {
        foreach (array_reverse($this->mailer->sent) as $message) {
            if (preg_match('/token=([A-Za-z0-9_-]{43})/', $message->body, $m) === 1) {
                return $m[1];
            }
        }
        throw new \RuntimeException('no quote email was sent');
    }

    /** What the customer types when approving. @return array<string,mixed> */
    public static function approval(int $revision, array $over = []): array
    {
        return $over + ['revision' => $revision, 'line1' => '12 Main Street', 'line2' => 'Apt 4', 'city' => 'Flint', 'state' => 'MI', 'postcode' => '48503', 'country' => 'US', 'phone' => '+1 810 555 0100', 'accepted' => true];
    }

    public static function json(array $data): \stdClass
    {
        return Json::decode(json_encode($data, JSON_THROW_ON_ERROR));
    }

    public function intake(): Intake
    {
        return new Intake($this->repo, $this->files, $this->sanitizer, $this->mailer, $this->emails, $this->settings, fn (): int => $this->time, fn (int $id): string => $this->adminUrl($id));
    }

    /** @return array<string,mixed> */
    public static function request(array $over = []): array
    {
        return $over + [
            'name' => 'Robin Hood',
            'email' => 'robin@example.com',
            'projectType' => 'game-case',
            'game' => 'Catan',
            'description' => 'A case for the base game and both expansions, with room for the sleeves.',
            'dimensions' => '12 x 12 x 4 in',
            'quantity' => 2,
            'colors' => 'Forest green and black',
            'deadline' => '',
            'shipTo' => 'US 48503',
        ];
    }

    /** The body the storefront sends. @param list<array<string,string>> $files */
    public static function body(array $request = [], array $files = [], ?string $clientKey = null): \stdClass
    {
        $body = ['request' => self::request($request), 'clientKey' => $clientKey ?? str_repeat('a', 64)];
        if ($files !== []) {
            $body['files'] = $files;
        }
        return Json::decode(json_encode($body, JSON_THROW_ON_ERROR));
    }

    /** @return array{name:string,type:string,data:string} */
    public static function picture(string $mime = 'image/png', string $name = 'logo.png'): array
    {
        return ['name' => $name, 'type' => $mime, 'data' => base64_encode(ImagePolicyTest::picture($mime))];
    }
}
