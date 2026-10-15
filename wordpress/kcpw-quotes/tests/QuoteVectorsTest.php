<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\ApprovalInput;
use KcPrintworks\Quotes\Domain\QuoteInput;
use KcPrintworks\Quotes\Support\Json;

/**
 * The shared vectors (packages/contracts/test/vectors/quotes.json), generated from the TypeScript reference. Passing them is the
 * definition of "the shop checks a request exactly as the storefront does".
 */
final class QuoteVectorsTest extends TestCase
{
    private function vectors(): \stdClass
    {
        $file = dirname(__DIR__, 3) . '/packages/contracts/test/vectors/quotes.json';
        if (!is_file($file)) {
            $this->skip('shared quote vectors not found');
        }
        return Json::decode((string) file_get_contents($file));
    }

    /** @param \stdClass $expected */
    private function same(string $label, \stdClass $expected, \KcPrintworks\Quotes\Domain\QuoteValidation $result): void
    {
        $this->assertSame($expected->ok, $result->ok, "$label: ok");
        $this->assertSame(
            array_map(static fn ($i): array => ['field' => $i->field, 'code' => $i->code], $expected->issues),
            array_map(static fn (array $i): array => ['field' => $i['field'], 'code' => $i['code']], $result->issues),
            "$label: issues",
        );
        if ($expected->ok) {
            $this->assertSame(Json::assoc($expected->value), $result->value, "$label: cleaned values");
        } else {
            $this->assertNull($result->value, "$label: no value when refused");
        }
    }

    public function testEveryRequestVectorGivesTheSameVerdictAsTheTypeScriptReference(): void
    {
        $vectors = $this->vectors();
        $this->assertTrue(count($vectors->request) >= 70, 'expected the full set of request cases');
        foreach ($vectors->request as $case) {
            $this->same('request: ' . $case->name, $case->expected, QuoteInput::validate($case->input));
        }
    }

    public function testEveryApprovalVectorGivesTheSameVerdictAsTheTypeScriptReference(): void
    {
        $vectors = $this->vectors();
        $this->assertTrue(count($vectors->approval) >= 30, 'expected the full set of approval cases');
        foreach ($vectors->approval as $case) {
            $this->same('approval: ' . $case->name, $case->expected, ApprovalInput::validate($case->input));
        }
    }

    public function testCalendarDatesAndDeadlinesAgree(): void
    {
        $vectors = $this->vectors();
        foreach ($vectors->dates as $case) {
            $this->assertSame($case->valid, QuoteInput::isCalendarDate($case->date), 'date ' . $case->date);
        }
        foreach ($vectors->deadlines as $case) {
            $this->assertSame($case->problem, QuoteInput::deadlineProblem($case->deadline, $case->today), 'deadline ' . $case->deadline . ' on ' . $case->today);
        }
    }

    public function testTheLimitsAndChoicesAreTheOnesTheReferenceUses(): void
    {
        $limits = $this->vectors()->limits;
        $this->assertSame($limits->nameMin, QuoteInput::NAME_MIN);
        $this->assertSame($limits->nameMax, QuoteInput::NAME_MAX);
        $this->assertSame($limits->emailMax, QuoteInput::EMAIL_MAX);
        $this->assertSame($limits->gameMax, QuoteInput::GAME_MAX);
        $this->assertSame($limits->descriptionMin, QuoteInput::DESCRIPTION_MIN);
        $this->assertSame($limits->descriptionMax, QuoteInput::DESCRIPTION_MAX);
        $this->assertSame($limits->dimensionsMax, QuoteInput::DIMENSIONS_MAX);
        $this->assertSame($limits->colorsMax, QuoteInput::COLORS_MAX);
        $this->assertSame($limits->shipToMax, QuoteInput::SHIP_TO_MAX);
        $this->assertSame($limits->quantityMin, QuoteInput::QUANTITY_MIN);
        $this->assertSame($limits->quantityMax, QuoteInput::QUANTITY_MAX);
        $this->assertSame($limits->linksInDescriptionMax, QuoteInput::LINKS_IN_DESCRIPTION_MAX);
        $this->assertSame($limits->addressLineMin, ApprovalInput::ADDRESS_LINE_MIN);
        $this->assertSame($limits->addressLineMax, ApprovalInput::ADDRESS_LINE_MAX);
        $this->assertSame($limits->cityMin, ApprovalInput::CITY_MIN);
        $this->assertSame($limits->cityMax, ApprovalInput::CITY_MAX);
        $this->assertSame($limits->stateMax, ApprovalInput::STATE_MAX);
        $this->assertSame(Json::assoc($this->vectors()->projectTypes), array_keys(QuoteInput::PROJECT_TYPES));
    }

    public function testAWholeNumberWrittenWithADecimalPointIsStillAWholeNumberAndNothingElseIs(): void
    {
        $base = '{"name":"Robin Hood","email":"robin@example.com","projectType":"other","description":"Something small to hold my dice.","quantity":%s}';
        $this->assertTrue(QuoteInput::validate(Json::decode(sprintf($base, '3.0')))->ok);
        $this->assertFalse(QuoteInput::validate(Json::decode(sprintf($base, '2.5')))->ok);
        $this->assertFalse(QuoteInput::validate(Json::decode(sprintf($base, 'true')))->ok);
        $this->assertFalse(QuoteInput::validate(Json::decode(sprintf($base, '"3"')))->ok);
    }

    public function testBytesThatAreNotUtf8AreRefusedNotRepaired(): void
    {
        $input = new \stdClass();
        $input->name = "Rob\xC3\x28in";
        $input->email = 'robin@example.com';
        $input->projectType = 'other';
        $input->description = "Something small \xFF to hold my dice.";
        $input->quantity = 1;
        $result = QuoteInput::validate($input);
        $this->assertFalse($result->ok);
        $codes = array_map(static fn (array $i): string => $i['field'] . ':' . $i['code'], $result->issues);
        $this->assertSame(['name:invalid_characters', 'description:invalid_characters'], $codes);
    }
}
