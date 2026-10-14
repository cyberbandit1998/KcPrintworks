<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Reviews\ReviewInput;
use KcPrintworks\Core\Support\Json;

/**
 * The shared review vectors (packages/contracts/test/vectors/reviews.json), generated from the TypeScript reference. Passing them is
 * the definition of "the shop checks a review exactly as the storefront does".
 */
final class ReviewVectorsTest extends TestCase
{
    private function vectors(): \stdClass
    {
        $file = dirname(__DIR__, 3) . '/packages/contracts/test/vectors/reviews.json';
        if (!is_file($file)) {
            $this->skip('shared review vectors not found');
        }
        return Json::decode((string) file_get_contents($file));
    }

    public function testEveryVectorGivesTheSameVerdictAsTheTypeScriptReference(): void
    {
        $vectors = $this->vectors();
        $this->assertTrue(count($vectors->cases) >= 60, 'expected the full set of cases');
        foreach ($vectors->cases as $case) {
            $result = ReviewInput::validate($case->input);
            $expected = $case->expected;
            $label = $case->name;
            $this->assertSame($expected->ok, $result->ok, "$label: ok");
            $this->assertSame(
                array_map(static fn ($i): array => ['field' => $i->field, 'code' => $i->code], $expected->issues),
                array_map(static fn (array $i): array => ['field' => $i['field'], 'code' => $i['code']], $result->issues),
                "$label: issues",
            );
            if ($expected->ok) {
                $this->assertSame(Json::assoc($expected->value), $result->value, "$label: normalized values");
            } else {
                $this->assertNull($result->value, "$label: no value when refused");
            }
        }
    }

    public function testTheLimitsAreTheOnesTheReferenceUses(): void
    {
        $limits = $this->vectors()->limits;
        $this->assertSame($limits->nameMin, ReviewInput::NAME_MIN);
        $this->assertSame($limits->nameMax, ReviewInput::NAME_MAX);
        $this->assertSame($limits->emailMax, ReviewInput::EMAIL_MAX);
        $this->assertSame($limits->textMin, ReviewInput::TEXT_MIN);
        $this->assertSame($limits->textMax, ReviewInput::TEXT_MAX);
    }

    public function testAWholeNumberWrittenWithADecimalPointIsStillAWholeNumber(): void
    {
        // JavaScript cannot tell 5 from 5.0, so neither may this side.
        $input = Json::decode('{"productId":42.0,"rating":5.0,"name":"Robin Hood","email":"robin@example.com","review":"A really lovely case indeed."}');
        $this->assertTrue(ReviewInput::validate($input)->ok);
        $fraction = Json::decode('{"productId":42,"rating":4.5,"name":"Robin Hood","email":"robin@example.com","review":"A really lovely case indeed."}');
        $this->assertFalse(ReviewInput::validate($fraction)->ok);
        $bool = Json::decode('{"productId":true,"rating":true,"name":"Robin Hood","email":"robin@example.com","review":"A really lovely case indeed."}');
        $this->assertFalse(ReviewInput::validate($bool)->ok);
    }

    public function testBytesThatAreNotUtf8AreRefusedNotRepaired(): void
    {
        $input = new \stdClass();
        $input->productId = 42;
        $input->rating = 5;
        $input->name = "Rob\xC3\x28in";
        $input->email = 'robin@example.com';
        $input->review = "A really lovely case \xFF indeed.";
        $result = ReviewInput::validate($input);
        $this->assertFalse($result->ok);
        $codes = array_map(static fn (array $i): string => $i['field'] . ':' . $i['code'], $result->issues);
        $this->assertSame(['name:invalid_characters', 'review:invalid_characters'], $codes);
    }
}
