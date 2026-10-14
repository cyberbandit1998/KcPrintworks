<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Cart\LineResolver;
use KcPrintworks\Core\Cart\RequestError;
use KcPrintworks\Core\Catalog\ArrayProductSource;
use KcPrintworks\Core\Catalog\ProductModel;
use KcPrintworks\Core\Handoff\HandoffRequest;
use KcPrintworks\Core\Handoff\HandoffResult;
use KcPrintworks\Core\Handoff\HandoffService;
use KcPrintworks\Core\Handoff\MemoryHandoffStore;
use KcPrintworks\Core\Handoff\Redemption;
use KcPrintworks\Core\Support\Json;

final class HandoffServiceTest extends TestCase
{
    private int $now = 1_800_000_000;
    private MemoryHandoffStore $store;
    private ArrayProductSource $products;
    private HandoffService $service;
    private int $tokens = 0;

    private function setUpService(): void
    {
        $file = dirname(__DIR__, 3) . '/packages/contracts/test/vectors/lines.json';
        if (!is_file($file)) {
            $this->skip('shared vectors not found');
        }
        $vectors = Json::decode((string) file_get_contents($file));
        $this->products = new ArrayProductSource();
        foreach (get_object_vars($vectors->products) as $dto) {
            $product = ProductModel::fromDto(Json::assoc($dto));
            $this->products->add($product);
        }
        $this->store = new MemoryHandoffStore();
        $this->tokens = 0;
        $this->service = new HandoffService(
            $this->products,
            $this->store,
            new LineResolver(),
            'https://shop.example.com',
            fn (): int => $this->now,
            fn (): string => str_pad('t' . ++$this->tokens, 43, 'x'),
        );
    }

    private function request(string $linesJson, string $extra = ''): HandoffRequest
    {
        return HandoffRequest::parse('{"lines":' . $linesJson . $extra . '}');
    }

    public function testAValidCartGetsASingleUseTokenAndTheServerOwnsEveryPrice(): void
    {
        $this->setUpService();
        $req = $this->request('[{"productId":11,"quantity":2,"options":{"name":"Robin","gift":true}},{"productId":10,"quantity":1}]');
        $result = $this->service->create($req->lines, 2 * (899 + 400) + 1324);
        $this->assertSame(HandoffResult::OK, $result->status);
        $this->assertSame(200, $result->httpStatus());
        $this->assertSame(2 * 1299 + 1324, $result->subtotalCents);
        $this->assertSame('https://shop.example.com/?kcpw_handoff=' . str_pad('t1', 43, 'x'), $result->redirectUrl);
        $this->assertSame($this->now + 600, $result->expiresAt);
        $this->assertCount(1, $this->store->rows);
        $stored = (string) array_values($this->store->rows)[0][0];
        $this->assertStringNotContains('1299', $stored, 'no price is stored, only the intents');
        $this->assertStringNotContains('price', $stored);
        $this->assertStringNotContains(str_pad('t1', 43, 'x'), implode('', array_keys($this->store->rows)), 'only a hash of the token is stored');

        $first = $this->service->redeem(str_pad('t1', 43, 'x'));
        $this->assertTrue($first->ok);
        $this->assertCount(2, $first->calls);
        $this->assertSame(11, $first->calls[0]->productId);
        $this->assertSame(['name' => 'Robin', 'gift' => true], $first->calls[0]->options);
        $this->assertSame(2, $first->calls[0]->quantity);

        $second = $this->service->redeem(str_pad('t1', 43, 'x'));
        $this->assertFalse($second->ok);
        $this->assertSame(Redemption::INVALID_TOKEN, $second->code, 'a token works once');
    }

    public function testTheTokenExpiresAfterTenMinutes(): void
    {
        $this->setUpService();
        $req = $this->request('[{"productId":10,"quantity":1}]');
        $this->service->create($req->lines);
        $this->now += 601;
        $this->assertSame(Redemption::INVALID_TOKEN, $this->service->redeem(str_pad('t1', 43, 'x'))->code);
    }

    public function testGuessedOrMalformedTokensFindNothing(): void
    {
        $this->setUpService();
        foreach (['', 'short', str_repeat('a', 43), str_repeat('!', 43), str_repeat('a', 44)] as $token) {
            $this->assertSame(Redemption::INVALID_TOKEN, $this->service->redeem($token)->code, $token);
        }
    }

    public function testAnyProblemWithAnyLineRefusesTheWholeHandoffAndStoresNothing(): void
    {
        $this->setUpService();
        $req = $this->request('[{"productId":10,"quantity":1},{"productId":13,"quantity":1},{"productId":11,"quantity":1,"options":{}}]');
        $result = $this->service->create($req->lines);
        $this->assertSame(HandoffResult::INVALID, $result->status);
        $this->assertSame(422, $result->httpStatus());
        $this->assertNull($result->redirectUrl);
        $this->assertCount(0, $this->store->rows);
        $body = $result->toArray();
        $this->assertSame([], $body['lines'][0]['issues']);
        $this->assertSame('out_of_stock', $body['lines'][1]['issues'][0]['code']);
        $this->assertSame('invalid_option', $body['lines'][2]['issues'][0]['code']);
        $this->assertSame('name', $body['lines'][2]['issues'][0]['field']);
        $this->assertFalse($body['ok']);
    }

    public function testADifferentExpectedSubtotalIsReportedNotAdjusted(): void
    {
        $this->setUpService();
        $req = $this->request('[{"productId":10,"quantity":2}]');
        $result = $this->service->create($req->lines, 2 * 1324 - 100);
        $this->assertSame(HandoffResult::CHANGED, $result->status);
        $this->assertSame(409, $result->httpStatus());
        $this->assertSame(2648, $result->subtotalCents, 'the server figure is reported');
        $this->assertCount(0, $this->store->rows);
    }

    public function testTheCartIsCheckedAgainWhenTheTokenIsUsed(): void
    {
        $this->setUpService();
        $req = $this->request('[{"productId":10,"quantity":1}]');
        $this->service->create($req->lines);
        // The product sells out during the shopper's ten minutes.
        $sold = ProductModel::fromDto(Json::assoc(Json::decode((string) json_encode([
            'id' => 10, 'type' => 'simple', 'name' => 'Plain Case', 'price' => ['amount' => 1324, 'currency' => 'USD'],
            'attributes' => [], 'variations' => [], 'optionSchema' => ['version' => 1, 'fields' => []],
            'availability' => ['purchasable' => true, 'stockStatus' => 'outofstock', 'madeToOrder' => false],
        ]))));
        $this->products->add($sold);
        $redeemed = $this->service->redeem(str_pad('t1', 43, 'x'));
        $this->assertFalse($redeemed->ok);
        $this->assertSame(Redemption::CHANGED, $redeemed->code);
        $this->assertSame('out_of_stock', $redeemed->problems[0]['issues'][0]['code']);
    }

    public function testAnAnyVariationCarriesTheShoppersChoiceToWooCommerce(): void
    {
        $this->setUpService();
        $req = $this->request('[{"productId":30,"variationId":301,"quantity":1,"attributes":{"tag-color":"navy","text-color":"red"},"options":{"name":"Robin"}}]');
        $result = $this->service->create($req->lines);
        $this->assertSame(HandoffResult::OK, $result->status);
        $call = $this->service->redeem(str_pad('t1', 43, 'x'))->calls[0];
        $this->assertSame(301, $call->variationId);
        // No WooCommerce attribute keys in the vector products, so the defaults are used: attribute_<slug> => option name.
        $this->assertSame(['attribute_tag-color' => 'Navy', 'attribute_text-color' => 'Red'], $call->variationAttributes);
    }

    public function testQuoteStoresNothing(): void
    {
        $this->setUpService();
        $req = $this->request('[{"productId":10,"quantity":3}]');
        $quote = $this->service->quote($req->lines);
        $this->assertSame(HandoffResult::OK, $quote->status);
        $this->assertSame(3972, $quote->subtotalCents);
        $this->assertNull($quote->redirectUrl);
        $this->assertCount(0, $this->store->rows);
    }

    public function testTheRequestParserIsStrict(): void
    {
        $bad = [
            '{"lines":[{"productId":10,"quantity":1,"price":1}]}' => 'unexpected field "price"',
            '{"lines":[{"productId":10,"quantity":1}],"total":5}' => 'Prices and totals',
            '{"lines":[{"productId":10,"quantity":1}],"coupon":"X"}' => 'Unexpected field "coupon"',
            '{"lines":[]}' => 'lines must be',
            '{"lines":[{"productId":0,"quantity":1}]}' => 'productId',
            '{"lines":[{"productId":1,"quantity":100}]}' => 'quantity',
            '{"lines":[{"productId":1,"quantity":1.5}]}' => 'quantity',
            '{"lines":[{"productId":"1","quantity":1}]}' => 'productId',
            '{"lines":[{"productId":1,"quantity":1,"options":[]}]}' => 'options must be an object',
            '{"lines":[{"productId":1,"quantity":1,"options":{"a":5}}]}' => 'option "a"',
            '{"lines":[{"productId":1,"quantity":1,"attributes":{"a":5}}]}' => 'attribute "a"',
            '{"lines":[{"productId":1,"quantity":1}],"expectedSubtotal":-1}' => 'expectedSubtotal',
            '{"lines":[{"productId":1,"quantity":1}],"expectedSubtotal":"5"}' => 'expectedSubtotal',
            '[1]' => 'JSON object',
            '{nope' => 'not valid JSON',
        ];
        foreach ($bad as $body => $needle) {
            $this->assertThrows(RequestError::class, static fn () => HandoffRequest::parse($body), $needle);
        }
        $fiftyOne = '{"lines":[' . implode(',', array_fill(0, 51, '{"productId":1,"quantity":1}')) . ']}';
        $this->assertThrows(RequestError::class, static fn () => HandoffRequest::parse($fiftyOne), 'lines must be');
        $this->assertThrows(RequestError::class, static fn () => HandoffRequest::parse(str_repeat(' ', 64_001)), 'too large');
    }

    public function testIdenticalChoicesShareALineKeyAndDifferentChoicesDoNot(): void
    {
        $a = HandoffRequest::parse('{"lines":[{"productId":11,"quantity":1,"options":{"name":"Robin","gift":false}},{"productId":11,"quantity":3,"options":{"name":"Robin"}},{"productId":11,"quantity":1,"options":{"name":"Sam"}}]}');
        $this->assertSame($a->lines[0]->key(), $a->lines[1]->key());
        $this->assertTrue($a->lines[0]->key() !== $a->lines[2]->key());
    }
}
