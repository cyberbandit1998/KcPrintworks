<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Repo\QuoteRepository;
use KcPrintworks\Quotes\Repo\Rows;
use KcPrintworks\Quotes\Wp\Schema;
use KcPrintworks\Quotes\Wp\WpdbQuoteRepository;

/** The database store, on SQLite through FakeWpdb: the same contract as the in-memory store, with the real SQL. */
final class WpdbRepositoryTest extends TestCase
{
    use RepositoryContract;

    protected function repo(): QuoteRepository
    {
        $GLOBALS['wpdb'] = new FakeWpdb();
        return WpdbQuoteRepository::forSite();
    }

    public function testTheMysqlTableDefinitionsHaveExactlyTheColumnsTheCodeUses(): void
    {
        $GLOBALS['wpdb'] = new FakeWpdb();
        $statements = Schema::statements('DEFAULT CHARACTER SET utf8mb4', 'wp_');
        $this->assertCount(4, $statements);
        $columns = [];
        foreach (explode("\n", $statements[0]) as $line) {
            if (preg_match('/^\s{2}([a-z_]+) (?:BIGINT|VARCHAR|CHAR|LONGTEXT|TEXT|INT|TINYINT)\b/', $line, $m) === 1) {
                $columns[] = $m[1];
            }
        }
        $this->assertSame(array_merge(['id'], array_keys(Rows::DEFAULTS)), $columns, 'quotes table columns, in order');
        // dbDelta's layout rules: two spaces after PRIMARY KEY, KEY (not INDEX), one column per line.
        foreach ($statements as $statement) {
            $this->assertStringContains('PRIMARY KEY  (id)', $statement);
            $this->assertStringNotContains('INDEX', $statement);
        }
        $this->assertStringContains('UNIQUE KEY ref (ref)', $statements[0]);
        $this->assertStringContains('UNIQUE KEY stored_name (stored_name)', $statements[1]);
    }

    public function testEveryValueTravelsThroughPrepareNeverIntoTheSqlText(): void
    {
        $db = new FakeWpdb();
        $GLOBALS['wpdb'] = $db;
        $repo = WpdbQuoteRepository::forSite();
        $evil = "x'; DROP TABLE wp_kcpw_quotes; --";
        $quote = $repo->create(['ref' => 'KCQ-2610-EVILAA', 'name' => $evil, 'email' => 'a@example.com', 'description' => $evil]);
        $repo->swap($quote->id(), [$evil], ['game' => $evil], ['name' => $evil], 5);
        $repo->search(new \KcPrintworks\Quotes\Repo\QuoteQuery(search: $evil));
        $this->assertSame($evil, $repo->find($quote->id())?->name());
        $this->assertSame(1, $repo->counts()['new']);
        foreach ($db->log as $sql) {
            $this->assertStringNotContains('DROP TABLE', str_replace("''", '', $sql) === $sql ? $sql : (string) preg_replace("/'(?:[^']|'')*'/", "''", $sql), 'no statement carries the injected text outside a quoted value');
        }
    }

    public function testASwapThatNamesAnUnknownColumnIsARefusedBug(): void
    {
        $repo = $this->repo();
        $quote = $repo->create(['ref' => 'KCQ-2610-BADCOL', 'email' => 'a@example.com']);
        $this->assertThrows(\InvalidArgumentException::class, fn () => $repo->swap($quote->id(), [], ['status; DROP TABLE x' => 'new'], [], 1));
        $this->assertThrows(\InvalidArgumentException::class, fn () => $repo->swap($quote->id(), [], ['id' => 5], [], 1));
    }
}
