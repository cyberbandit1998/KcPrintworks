<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Admin\EmptyMappingStore;
use KcPrintworks\Etsy\Admin\MemorySettingsStore;
use KcPrintworks\Etsy\Admin\PreviewService;
use KcPrintworks\Etsy\Admin\Views;
use KcPrintworks\Etsy\Match\ArrayDecisionStore;
use KcPrintworks\Etsy\Snapshot\MemorySnapshotStore;
use KcPrintworks\Etsy\Snapshot\RunState;

final class ViewsTest extends TestCase
{
    private const XSS = '<script>alert(1)</script>';

    private function vm(): array
    {
        return ['missing' => ['KCPW_ETSY_API_KEY'], 'connected' => true, 'shop_name' => self::XSS, 'shop_id' => 99, 'scopes' => ['shops_r', 'listings_r'], 'expires_at' => '2026-10-14 13:00', 'connected_at' => '2026-10-14', 'callback_url' => 'https://shop.example.com/wp-json/kcpw-etsy/v1/oauth/callback', 'last_test' => ['ok' => true, 'at' => 'now', 'checks' => [['name' => self::XSS, 'status' => 'warn', 'detail' => self::XSS]]], 'requested_scopes' => ['shops_r', 'listings_r']];
    }

    private function result(): \KcPrintworks\Etsy\Admin\PreviewResult
    {
        $snapshots = new MemorySnapshotStore();
        $snapshots->saveListing(1, Fixtures::rawListing(1, ['title' => self::XSS . ' Skip-Bo']));
        $snapshots->saveDetails(1, Fixtures::rawInventory([[1, 'S', ['C' => 'x'], 100]]), Fixtures::rawImages([5551234567]));
        $woo = new FixedWooReader([Fixtures::woo(30, 'Skip-Bo Card Game Travel Case', ['il_fullxfull.5551234567_ab12.jpg']), Fixtures::woo(900, self::XSS, ['il_fullxfull.5551234567_cd34.jpg'])]);
        return (new PreviewService($snapshots, $woo, new ArrayDecisionStore(), new EmptyMappingStore(), new MemorySettingsStore()))->build();
    }

    public function testNothingFromEtsyOrTheStoreReachesThePageUnescaped(): void
    {
        $views = new Views(new FakeGateway());
        $html = $views->connection($this->vm()) . $views->preview($this->result(), new RunState(), ['connected' => true]) . $views->plan($this->result(), []);
        $this->assertStringNotContains('<script>alert(1)</script>', $html);
        $this->assertStringContains('&lt;script&gt;alert(1)&lt;/script&gt;', $html);
    }

    public function testEveryFormCarriesItsOwnNonceAndPostsToAdminPost(): void
    {
        $views = new Views(new FakeGateway());
        $connected = $views->connection($this->vm());
        foreach (['kcpw_etsy_test', 'kcpw_etsy_disconnect'] as $action) {
            $this->assertStringContains('admin-post.php?action=' . $action, $connected);
            $this->assertStringContains('value="nonce-' . $action . '"', $connected);
        }
        $disconnected = $views->connection(['connected' => false] + $this->vm());
        $this->assertStringContains('value="nonce-kcpw_etsy_connect"', $disconnected);
        $preview = $views->preview($this->result(), new RunState(), ['connected' => true]);
        $this->assertStringContains('value="nonce-kcpw_etsy_decisions"', $preview);
        $this->assertStringContains('value="nonce-kcpw_etsy_refresh"', $preview);
        $this->assertStringContains('_wpnonce=nonce-kcpw_etsy_download', $preview, 'download links carry a nonce');
    }

    public function testTheReadOnlyPromiseIsStatedOnEveryScreenAndNoControlOffersAWrite(): void
    {
        $views = new Views(new FakeGateway());
        foreach ([$views->connection($this->vm()), $views->preview($this->result(), new RunState(), ['connected' => true]), $views->plan($this->result(), [])] as $html) {
            $this->assertStringContains('Read-only phase', $html);
            $this->assertStringContains('cannot create, change, or delete a product', $html);
            foreach (['Apply', 'Synchronize now', 'Publish', 'Delete product'] as $writeLabel) {
                $this->assertStringNotContains('>' . $writeLabel, $html);
            }
        }
    }

    public function testTheDecisionFormOffersTheCandidatesTheSuggestionAndSafeChoicesOnly(): void
    {
        $html = (new Views(new FakeGateway()))->preview($this->result(), new RunState(), ['connected' => true]);
        $this->assertStringContains('name="decision[1]"', $html);
        $this->assertStringContains('value="link:30"', $html);
        $this->assertStringContains('value="link:900"', $html);
        $this->assertStringContains('(suggested)', $html);
        $this->assertStringContains('value="create_new"', $html);
        $this->assertStringContains('value="ignore"', $html);
        $this->assertStringContains('for="decision-1"', $html, 'every select has a label');
    }

    public function testTablesHaveCaptionsAndColumnHeadersForScreenReaders(): void
    {
        $html = (new Views(new FakeGateway()))->preview($this->result(), new RunState(), ['connected' => true]);
        $this->assertTrue(substr_count($html, '<caption') >= 2);
        $this->assertTrue(substr_count($html, 'scope="col"') >= 4);
        $this->assertStringContains('aria-live="polite"', $html);
    }

    public function testAProgressPageRefreshesItselfOnlyWhileADownloadIsRunning(): void
    {
        $views = new Views(new FakeGateway());
        $running = new RunState(RunState::DETAILS, '2026-10-14', '', 66, 10, 0);
        $this->assertStringContains('http-equiv="refresh"', $views->preview($this->result(), $running, ['connected' => true]));
        $this->assertStringNotContains('http-equiv="refresh"', $views->preview($this->result(), new RunState(RunState::DONE), ['connected' => true]));
    }
}
