<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Domain\OfferInput;
use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Mail\Mailer;
use KcPrintworks\Quotes\Mail\Message;
use KcPrintworks\Quotes\Repo\QuoteQuery;
use KcPrintworks\Quotes\Repo\QuoteRepository;
use KcPrintworks\Quotes\Service\Admin;
use KcPrintworks\Quotes\Service\OrderGateway;
use KcPrintworks\Quotes\Service\Settings;
use KcPrintworks\Quotes\Support\Money;
use KcPrintworks\Quotes\Upload\FileStore;

/**
 * The "Custom Quotes" dashboard: the menu, the three screens (list, one quote, setup check) and the buttons on them.
 *
 * Every button is a POST to admin-post.php that checks, in this order: the person may manage the shop (manage_woocommerce), and a nonce
 * made for exactly this button and this quote. Only then does it hand over to Service\Admin, which decides whether the move is allowed.
 * What happened is shown on the next page load from a short-lived per-user transient, so no message text is ever carried in a URL.
 * Customer pictures are sent only through the signed-in file handler below, never from a public address.
 */
final class AdminScreens
{
    public const CAPABILITY = 'manage_woocommerce';
    private const NOTICE_KEY = 'kcpw_q_notice_';

    public function __construct(
        private readonly QuoteRepository $repo,
        private readonly Admin $admin,
        private readonly OrderGateway $orders,
        private readonly FileStore $files,
        private readonly Settings $settings,
        private readonly AdminViews $views,
        private readonly Mailer $mailer,
    ) {
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
        foreach (['send', 'status', 'note', 'email', 'attention', 'file', 'testmail'] as $verb) {
            add_action('admin_post_kcpw_quote_' . $verb, [$this, 'handle' . ucfirst($verb)]);
        }
    }

    public static function quoteUrl(int $id): string
    {
        return admin_url('admin.php?' . http_build_query(['page' => AdminViews::PAGE, 'quote' => $id]));
    }

    public function menu(): void
    {
        $waiting = $this->repo->counts()[Status::NEW] ?? 0;
        $bubble = $waiting > 0 ? ' <span class="awaiting-mod">' . (int) $waiting . '</span>' : '';
        add_menu_page('Custom Quotes', 'Custom Quotes' . $bubble, self::CAPABILITY, AdminViews::PAGE, [$this, 'render'], 'dashicons-format-chat', 56);
    }

    // ------------------------------------------------------------------------------------------------ screens

    public function render(): void
    {
        echo $this->page();
    }

    /** The HTML of whichever screen the address asks for. */
    public function page(): string
    {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('You do not have permission to see this page.', 'kcpw-quotes'), '', ['response' => 403]);
        }
        $notice = $this->takeNotice();
        $view = $this->query('view');
        if ($view === 'health') {
            return $this->views->health(HealthProbe::checks(true), $notice === null ? null : ['type' => $notice['type'], 'messages' => $notice['messages']]);
        }
        $id = (int) $this->query('quote');
        if ($id > 0) {
            $quote = $this->repo->find($id);
            if ($quote === null) {
                return $this->views->list($this->repo->search(new QuoteQuery()), $this->repo->counts(), $this->attentionCount(), '', '', false, ['type' => 'error', 'messages' => ['That quote does not exist.']]);
            }
            return $this->views->detail($this->detail($quote, $notice));
        }
        $status = $this->query('status');
        $status = Status::isKnown($status) ? $status : '';
        $search = mb_substr(sanitize_text_field($this->query('s')), 0, 100);
        $attentionOnly = $this->query('attention') === '1';
        $paged = max(1, (int) $this->query('paged'));
        $result = $this->repo->search(new QuoteQuery($status, $search, $paged, QuoteQuery::PER_PAGE, $attentionOnly));
        return $this->views->list($result, $this->repo->counts(), $this->attentionCount(), $status, $search, $attentionOnly, $notice === null ? null : ['type' => $notice['type'], 'messages' => $notice['messages']]);
    }

    private function attentionCount(): int
    {
        return $this->repo->search(new QuoteQuery(attentionOnly: true, perPage: 1))->total;
    }

    /** @param array{type:string,messages:list<string>,form?:array<string,string>}|null $notice */
    private function detail(Quote $quote, ?array $notice): AdminDetail
    {
        $form = $notice['form'] ?? $this->savedForm($quote);
        $orderLink = '';
        $orderStatus = '';
        if ($quote->orderId() > 0) {
            $orderLink = $this->orders->adminUrl($quote->orderId());
            $facts = $this->orders->inspect($quote->orderId());
            $orderStatus = $facts !== null ? ucfirst($facts->status) : 'not found';
        }
        return new AdminDetail(
            $quote,
            $this->repo->files($quote->id()),
            $this->repo->notes($quote->id()),
            $this->repo->events($quote->id()),
            $form,
            $notice === null ? null : ['type' => $notice['type'], 'messages' => $notice['messages']],
            $orderLink,
            $orderStatus,
            $this->settings->storefrontUrl !== '',
        );
    }

    /** @return array<string,string> */
    private function savedForm(Quote $quote): array
    {
        return [
            'title' => $quote->title(),
            'details' => $quote->details(),
            'item_price' => $quote->itemCents() > 0 ? Money::format($quote->itemCents(), 2) : '',
            'shipping_price' => $quote->shipCents() > 0 ? Money::format($quote->shipCents(), 2) : '',
            'expires' => $quote->expiresAt() > $this->nowTime() ? (new \DateTimeImmutable('@' . $quote->expiresAt()))->setTimezone($this->settings->zone())->format('Y-m-d') : '',
        ];
    }

    protected function nowTime(): int
    {
        return time();
    }

    // ------------------------------------------------------------------------------------------------ buttons

    public function handleSend(): void
    {
        $quote = $this->guard('kcpw_quote_send');
        $form = [];
        foreach (['title', 'details', 'item_price', 'shipping_price', 'expires'] as $field) {
            $form[$field] = $this->post($field);
        }
        $offer = OfferInput::validate($form, $this->nowTime(), $this->settings->zone(), $this->settings->validDays);
        if (!$offer->ok || $offer->value === null) {
            $this->done($quote, 'error', array_map(static fn (array $i): string => $i['message'], $offer->issues), $form);
        }
        $outcome = $this->admin->sendQuote($quote->id(), $offer->value, $this->actor());
        $this->done($quote, $outcome->ok ? 'success' : 'error', [$outcome->message], $outcome->ok ? [] : $form);
    }

    public function handleStatus(): void
    {
        $quote = $this->guard('kcpw_quote_status');
        $outcome = $this->admin->changeStatus($quote->id(), $this->post('status'), $this->actor());
        $this->done($quote, $outcome->ok ? 'success' : 'error', [$outcome->message]);
    }

    public function handleNote(): void
    {
        $quote = $this->guard('kcpw_quote_note');
        $user = function_exists('wp_get_current_user') ? wp_get_current_user() : null;
        $author = $user !== null && isset($user->display_name) ? (string) $user->display_name : 'Staff';
        $outcome = $this->admin->addNote($quote->id(), (int) get_current_user_id(), $author, $this->post('note'));
        $this->done($quote, $outcome->ok ? 'success' : 'error', [$outcome->message]);
    }

    public function handleEmail(): void
    {
        $quote = $this->guard('kcpw_quote_email');
        $outcome = $this->admin->emailCustomer($quote->id(), $this->post('subject'), $this->post('message'), $this->actor());
        $this->done($quote, $outcome->ok ? 'success' : 'error', [$outcome->message]);
    }

    public function handleAttention(): void
    {
        $quote = $this->guard('kcpw_quote_attention');
        $outcome = $this->admin->clearAttention($quote->id(), $this->actor());
        $this->done($quote, $outcome->ok ? 'success' : 'error', [$outcome->message]);
    }

    public function handleTestmail(): void
    {
        $this->requireCapability();
        $this->requireNonce('kcpw_quote_testmail');
        $sent = $this->mailer->send(new Message($this->settings->notifyEmail, 'Test email from Custom Quotes', "This is a test email from the Custom Quotes plugin.\nIf you can read it, your site can send mail to this address.\n"));
        $this->setNotice($sent ? 'success' : 'error', [$sent ? 'A test email was sent to ' . $this->settings->notifyEmail . '. Check that it arrived.' : 'The test email could not be sent. Check your site\'s email setup (for example an SMTP plugin).']);
        $this->redirect(admin_url('admin.php?' . http_build_query(['page' => AdminViews::PAGE, 'view' => 'health'])));
    }

    /**
     * What the file handler would send for a picture: status, headers, bytes. The pictures are sent as their stored type with "nosniff" and a
     * sandboxing policy, and only to a signed-in person who may manage the shop.
     *
     * @return array{status:int,headers:array<string,string>,body:string}
     */
    public function serveFile(int $fileId): array
    {
        $file = $this->repo->file($fileId);
        $bytes = $file !== null ? $this->files->read($file->storedName) : null;
        if ($file === null || $bytes === null || !in_array($file->mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) {
            return ['status' => 404, 'headers' => ['Content-Type' => 'text/plain; charset=UTF-8', 'X-Content-Type-Options' => 'nosniff'], 'body' => 'Not found.'];
        }
        $name = (string) preg_replace('/[^A-Za-z0-9 ._()-]+/', '_', $file->displayName);
        return [
            'status' => 200,
            'headers' => [
                'Content-Type' => $file->mime,
                'Content-Length' => (string) strlen($bytes),
                'Content-Disposition' => 'inline; filename="' . $name . '"',
                'X-Content-Type-Options' => 'nosniff',
                'Content-Security-Policy' => "default-src 'none'; sandbox",
                'Cache-Control' => 'private, no-store',
                'X-Robots-Tag' => 'noindex',
            ],
            'body' => $bytes,
        ];
    }

    public function handleFile(): void
    {
        $this->requireCapability();
        $id = (int) ($this->query('file'));
        $this->requireNonce('kcpw_quote_file_' . $id, $this->query('_wpnonce'));
        $answer = $this->serveFile($id);
        if (function_exists('status_header')) {
            status_header($answer['status']);
        }
        foreach ($answer['headers'] as $name => $value) {
            header($name . ': ' . $value);
        }
        echo $answer['body'];
        exit;
    }

    // ------------------------------------------------------------------------------------------------ plumbing

    private function actor(): string
    {
        return 'admin:' . (int) get_current_user_id();
    }

    private function query(string $key): string
    {
        $value = $_GET[$key] ?? '';
        return is_string($value) ? (string) wp_unslash($value) : '';
    }

    private function post(string $key): string
    {
        $value = $_POST[$key] ?? '';
        return is_string($value) ? (string) wp_unslash($value) : '';
    }

    private function requireCapability(): void
    {
        if (!current_user_can(self::CAPABILITY)) {
            wp_die(esc_html__('You do not have permission to do this.', 'kcpw-quotes'), '', ['response' => 403]);
        }
    }

    private function requireNonce(string $action, ?string $nonce = null): void
    {
        $nonce ??= $this->post('_wpnonce');
        if (wp_verify_nonce($nonce, $action) === false) {
            wp_die(esc_html__('This page expired. Go back, reload it and try again.', 'kcpw-quotes'), '', ['response' => 403]);
        }
    }

    /** Checks who and which button, and returns the quote the button is about. */
    private function guard(string $action): Quote
    {
        $this->requireCapability();
        $id = (int) $this->post('quote_id');
        $this->requireNonce($action . '_' . $id);
        $quote = $id > 0 ? $this->repo->find($id) : null;
        if ($quote === null) {
            wp_die(esc_html__('That quote does not exist.', 'kcpw-quotes'), '', ['response' => 404]);
        }
        return $quote;
    }

    /**
     * @param list<string> $messages
     * @param array<string,string> $form
     */
    private function done(Quote $quote, string $type, array $messages, array $form = []): never
    {
        $this->setNotice($type, $messages, $form);
        $this->redirect(self::quoteUrl($quote->id()));
    }

    /**
     * @param list<string> $messages
     * @param array<string,string> $form
     */
    private function setNotice(string $type, array $messages, array $form = []): void
    {
        set_transient(self::NOTICE_KEY . (int) get_current_user_id(), ['type' => $type, 'messages' => $messages] + ($form !== [] ? ['form' => $form] : []), 120);
    }

    /** @return array{type:string,messages:list<string>,form?:array<string,string>}|null */
    private function takeNotice(): ?array
    {
        $key = self::NOTICE_KEY . (int) get_current_user_id();
        $notice = get_transient($key);
        if (!is_array($notice)) {
            return null;
        }
        delete_transient($key);
        return $notice;
    }

    private function redirect(string $url): never
    {
        wp_safe_redirect($url);
        exit;
    }
}
