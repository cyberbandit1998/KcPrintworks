<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Tests;

use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Wp\AdminScreens;

final class AdminScreensTest extends TestCase
{
    private function screens(): AdminScreens
    {
        return \WpStub::$actions['admin_menu'][0][0];
    }

    /** Runs a button and returns where it redirected to (or the die message). */
    private function press(string $verb): string
    {
        try {
            foreach (\WpStub::$actions['admin_post_kcpw_quote_' . $verb] as $callback) {
                $callback();
            }
        } catch (\WpStubStop $stop) {
            return $stop->kind . ': ' . $stop->detail;
        }
        return 'no stop';
    }

    /** @return array{0:GlueFixtures,1:\KcPrintworks\Quotes\Domain\Quote} */
    private function shopWithRequest(array $request = [], array $files = []): array
    {
        $g = GlueFixtures::boot(true);
        \WpStub::$actions['rest_api_init'][0]();
        $body = json_encode(['request' => Fixtures::request($request), 'clientKey' => bin2hex(random_bytes(32))] + ($files !== [] ? ['files' => $files] : []));
        $saved = $g->call('POST', '/kcpw-quotes/v1/requests', $body);
        return [$g, $g->repo->findByRef($saved->data['ref'])];
    }

    private function post(string $action, int $id, array $fields): void
    {
        $_POST = ['quote_id' => (string) $id, '_wpnonce' => 'nonce-' . $action . '_' . $id] + $fields;
    }

    public function testTheMenuIsForShopManagersOnlyAndShowsHowManyAreWaiting(): void
    {
        [$g] = $this->shopWithRequest();
        \WpStub::$actions['admin_menu'][0]();
        $menu = \WpStub::$menus[0];
        $this->assertSame('manage_woocommerce', $menu['cap']);
        $this->assertSame('kcpw-quotes', $menu['slug']);
        $this->assertStringContains('<span class="awaiting-mod">1</span>', $menu['menu']);
        $g->cleanup();
    }

    public function testEveryScreenAndButtonRefusesAPersonWhoCannotManageTheShop(): void
    {
        [$g, $quote] = $this->shopWithRequest();
        \WpStub::$caps = ['read'];
        $this->assertThrows(\WpStubStop::class, fn () => $this->screens()->page(), '403');
        foreach (['send', 'status', 'note', 'email', 'attention', 'testmail', 'file'] as $verb) {
            $this->post('kcpw_quote_' . $verb, $quote->id(), ['status' => 'reviewing', 'note' => 'x', 'subject' => 'Hello there', 'message' => 'Hi']);
            $this->assertStringContains('[403]', $this->press($verb), $verb);
        }
        $this->assertSame(Status::NEW, $g->repo->find($quote->id())?->status());
        $this->assertSame([], $g->repo->notes($quote->id()));
        $g->cleanup();
    }

    public function testEveryButtonRefusesAMissingOrWrongNonce(): void
    {
        [$g, $quote] = $this->shopWithRequest();
        foreach (['send', 'status', 'note', 'email', 'attention'] as $verb) {
            $_POST = ['quote_id' => (string) $quote->id(), '_wpnonce' => 'nonce-something-else', 'status' => 'reviewing'];
            $this->assertStringContains('[403]', $this->press($verb), "$verb with a wrong nonce");
            $_POST = ['quote_id' => (string) $quote->id(), 'status' => 'reviewing'];
            $this->assertStringContains('[403]', $this->press($verb), "$verb with no nonce");
            // A nonce made for ANOTHER quote does not work either.
            $_POST = ['quote_id' => (string) $quote->id(), '_wpnonce' => 'nonce-kcpw_quote_' . $verb . '_9999', 'status' => 'reviewing'];
            $this->assertStringContains('[403]', $this->press($verb), "$verb with another quote's nonce");
        }
        $this->assertSame(Status::NEW, $g->repo->find($quote->id())?->status());
        $this->post('kcpw_quote_status', 424242, ['status' => 'reviewing']);
        $this->assertStringContains('[404]', $this->press('status'), 'a quote that does not exist');
        $g->cleanup();
    }

    public function testChangingTheStatusWorksAndShowsAMessageOnTheNextScreen(): void
    {
        [$g, $quote] = $this->shopWithRequest();
        $this->post('kcpw_quote_status', $quote->id(), ['status' => 'reviewing']);
        $result = $this->press('status');
        $this->assertSame('redirect: ' . AdminScreens::quoteUrl($quote->id()), $result);
        $this->assertSame(Status::REVIEWING, $g->repo->find($quote->id())?->status());
        $_GET = ['page' => 'kcpw-quotes', 'quote' => (string) $quote->id()];
        $html = $this->screens()->page();
        $this->assertStringContains('The quote is now Reviewing.', $html);
        $this->assertStringNotContains('The quote is now Reviewing.', $this->screens()->page(), 'a message is shown once');
        $this->post('kcpw_quote_status', $quote->id(), ['status' => 'paid']);
        $this->press('status');
        $this->assertSame(Status::REVIEWING, $g->repo->find($quote->id())?->status(), 'Paid cannot be set by hand');
        $this->assertStringContains('cannot be changed', $this->screens()->page());
        $g->cleanup();
    }

    public function testSendingAQuoteValidatesThePricesAndKeepsWhatWasTyped(): void
    {
        [$g, $quote] = $this->shopWithRequest();
        $this->post('kcpw_quote_send', $quote->id(), ['title' => 'Custom case', 'details' => 'Black', 'item_price' => 'abc', 'shipping_price' => '', 'expires' => '']);
        $this->press('send');
        $this->assertSame(Status::NEW, $g->repo->find($quote->id())?->status());
        $_GET = ['page' => 'kcpw-quotes', 'quote' => (string) $quote->id()];
        $html = $this->screens()->page();
        $this->assertStringContains('Enter the item price as a number', $html);
        $this->assertStringContains('value="Custom case"', $html, 'what was typed is still in the form');
        $this->assertStringContains('value="abc"', $html);

        \WpStub::$mail = [];
        $this->post('kcpw_quote_send', $quote->id(), ['title' => 'Custom case for Catan', 'details' => 'Black and orange', 'item_price' => '45.00', 'shipping_price' => '8.50', 'expires' => '']);
        $this->press('send');
        $after = $g->repo->find($quote->id());
        $this->assertSame(Status::QUOTED, $after?->status());
        $this->assertSame(5350, $after?->totalCents());
        $this->assertCount(1, \WpStub::$mail);
        $this->assertSame('robin@example.com', \WpStub::$mail[0]['to']);
        $this->assertStringContains('The quote was emailed to robin@example.com.', $this->screens()->page());
        $g->cleanup();
    }

    public function testNotesAndEmailsAndMarkingAsLookedAt(): void
    {
        [$g, $quote] = $this->shopWithRequest();
        $this->post('kcpw_quote_note', $quote->id(), ['note' => 'Call him on Tuesday']);
        $this->press('note');
        $this->assertSame('Kim Owner', $g->repo->notes($quote->id())[0]->author);
        $this->post('kcpw_quote_email', $quote->id(), ['subject' => 'A question about your case', 'message' => 'What lid color?']);
        \WpStub::$mail = [];
        $this->press('email');
        $this->assertSame('robin@example.com', \WpStub::$mail[0]['to']);
        $this->assertSame('A question about your case', \WpStub::$mail[0]['subject']);
        $g->repo->swap($quote->id(), [], ['attention' => 1, 'attention_reason' => 'check'], [], time());
        $this->post('kcpw_quote_attention', $quote->id(), []);
        $this->press('attention');
        $this->assertFalse($g->repo->find($quote->id())?->needsAttention());
        $g->cleanup();
    }

    public function testNothingCustomersTypeCanInjectMarkupIntoTheDashboard(): void
    {
        $evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
        [$g, $quote] = $this->shopWithRequest(['game' => 'Catan <b>x</b>', 'description' => 'A case please ' . $evil . ' and more words to pass the length check.', 'colors' => '"><svg onload=alert(3)>']);
        $g->repo->addNote($quote->id(), 7, $evil, $evil, time());
        $g->repo->swap($quote->id(), [], ['attention' => 1, 'attention_reason' => $evil, 'name' => $evil, 'quote_title' => $evil], [], time());

        $_GET = ['page' => 'kcpw-quotes', 'quote' => (string) $quote->id()];
        $detail = $this->screens()->page();
        $_GET = ['page' => 'kcpw-quotes'];
        $list = $this->screens()->page();
        $_GET = ['page' => 'kcpw-quotes', 's' => $evil];
        $search = $this->screens()->page();
        foreach (['detail' => $detail, 'list' => $list, 'search' => $search] as $name => $html) {
            $this->assertStringNotContains('<script>alert', $html, "$name: script");
            $this->assertStringNotContains('<img src=x', $html, "$name: img");
            $this->assertStringNotContains('<svg onload', $html, "$name: svg");
            $this->assertStringNotContains('<b>x</b>', $html, "$name: b");
        }
        $this->assertStringContains('&lt;script&gt;alert(1)&lt;/script&gt;', $detail);
        $g->cleanup();
    }

    public function testThePageUnderTheListShowsCountsSearchAndFilters(): void
    {
        [$g, $quote] = $this->shopWithRequest();
        $g->call('POST', '/kcpw-quotes/v1/requests', json_encode(['request' => Fixtures::request(['name' => 'Alice Archer', 'email' => 'alice@example.com', 'description' => 'A tall box for my card collection please.']), 'clientKey' => bin2hex(random_bytes(32))]));
        $g->admin->changeStatus($quote->id(), Status::REVIEWING, 'a');
        $_GET = ['page' => 'kcpw-quotes'];
        $all = $this->screens()->page();
        $this->assertStringContains('All <span class="count">(2)</span>', $all);
        $this->assertStringContains('New <span class="count">(1)</span>', $all);
        $this->assertStringContains('Reviewing <span class="count">(1)</span>', $all);
        $this->assertStringContains('Alice Archer', $all);
        $_GET = ['page' => 'kcpw-quotes', 'status' => 'reviewing'];
        $this->assertStringNotContains('Alice Archer', $this->screens()->page());
        $_GET = ['page' => 'kcpw-quotes', 's' => 'alice@'];
        $found = $this->screens()->page();
        $this->assertStringContains('Alice Archer', $found);
        $this->assertStringNotContains('Robin Hood', $found);
        $_GET = ['page' => 'kcpw-quotes', 'status' => 'banana'];
        $this->assertStringContains('Alice Archer', $this->screens()->page(), 'an unknown status filter is ignored');
        $g->cleanup();
    }

    public function testPicturesAreShownThroughASignedInHandlerWithSafeHeaders(): void
    {
        [$g, $quote] = $this->shopWithRequest([], [Fixtures::picture('image/png', 'logo.png')]);
        $file = $g->repo->files($quote->id())[0];
        $_GET = ['page' => 'kcpw-quotes', 'quote' => (string) $quote->id()];
        $html = $this->screens()->page();
        $this->assertStringContains('admin-post.php?action=kcpw_quote_file&amp;file=' . $file->id . '&amp;_wpnonce=nonce-kcpw_quote_file_' . $file->id, $html);
        $this->assertStringNotContains($file->storedName, $html, 'the stored name never appears on a page');
        $this->assertStringNotContains('wp-content/uploads', $html);

        $answer = $this->screens()->serveFile($file->id);
        $this->assertSame(200, $answer['status']);
        $this->assertSame('image/png', $answer['headers']['Content-Type']);
        $this->assertSame('nosniff', $answer['headers']['X-Content-Type-Options']);
        $this->assertStringContains('sandbox', $answer['headers']['Content-Security-Policy']);
        $this->assertSame('private, no-store', $answer['headers']['Cache-Control']);
        $this->assertSame("\x89PNG", substr($answer['body'], 0, 4));
        $this->assertSame(404, $this->screens()->serveFile(424242)['status']);

        // The handler itself wants the permission and a nonce for exactly this file.
        $_GET = ['file' => (string) $file->id, '_wpnonce' => 'nonce-kcpw_quote_file_9999'];
        $this->assertStringContains('[403]', $this->press('file'));
        \WpStub::$caps = [];
        $_GET = ['file' => (string) $file->id, '_wpnonce' => 'nonce-kcpw_quote_file_' . $file->id];
        $this->assertStringContains('[403]', $this->press('file'));
        $g->cleanup();
    }

    public function testAPictureWhoseStoredTypeIsNotAnImageIsNeverServed(): void
    {
        [$g, $quote] = $this->shopWithRequest([], [Fixtures::picture()]);
        $file = $g->repo->files($quote->id())[0];
        $g->db->query("UPDATE wp_kcpw_quote_files SET mime = 'text/html' WHERE id = " . $file->id);
        $this->assertSame(404, $this->screens()->serveFile($file->id)['status']);
        $g->cleanup();
    }

    public function testTheSetupCheckAndTestEmail(): void
    {
        [$g] = $this->shopWithRequest();
        $_GET = ['page' => 'kcpw-quotes', 'view' => 'health'];
        $html = $this->screens()->page();
        $this->assertStringContains('Setup checks', $html);
        $this->assertStringContains('Shared secret is set', $html);
        $this->assertStringNotContains(\KCPW_HANDOFF_SECRET, $html, 'the secret is never printed');
        \WpStub::$mail = [];
        $_POST = ['_wpnonce' => 'nonce-kcpw_quote_testmail'];
        $this->assertStringContains('redirect', $this->press('testmail'));
        $this->assertCount(1, \WpStub::$mail);
        $this->assertSame('contact@kcprintworks.com', \WpStub::$mail[0]['to']);
        $_GET = ['page' => 'kcpw-quotes', 'view' => 'health'];
        $this->assertStringContains('A test email was sent', $this->screens()->page());
        \WpStub::$mailWorks = false;
        $_POST = ['_wpnonce' => 'nonce-kcpw_quote_testmail'];
        $this->press('testmail');
        $this->assertStringContains('could not be sent', $this->screens()->page());
        $g->cleanup();
    }
}
