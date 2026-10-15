<?php
declare(strict_types=1);

namespace KcPrintworks\Quotes\Wp;

use KcPrintworks\Quotes\Domain\Quote;
use KcPrintworks\Quotes\Domain\QuoteInput;
use KcPrintworks\Quotes\Domain\Status;
use KcPrintworks\Quotes\Repo\QuotePage;
use KcPrintworks\Quotes\Service\Admin;
use KcPrintworks\Quotes\Service\Settings;
use KcPrintworks\Quotes\Support\Money;

/**
 * The dashboard's HTML. Every method RETURNS a string, and every piece of customer-supplied text goes through esc_html / esc_attr /
 * esc_url before it is added, so a quote request can never put markup or script into the owner's screen. No logic about quotes lives
 * here: what may be done and what happens is decided in src/Service.
 */
final class AdminViews
{
    public const PAGE = 'kcpw-quotes';

    public function __construct(private readonly Settings $settings)
    {
    }

    private static function h(string $text): string
    {
        return esc_html($text);
    }

    public function pageUrl(array $args = []): string
    {
        return esc_url(admin_url('admin.php?' . http_build_query(['page' => self::PAGE] + $args)));
    }

    public static function styles(): string
    {
        return '<style>
.kcpw-quotes .kcpw-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;background:#f0f0f1;color:#1d2327;border:1px solid #c3c4c7}
.kcpw-quotes .kcpw-badge--new{background:#fff3cd;border-color:#dba617}
.kcpw-quotes .kcpw-badge--quoted{background:#dbeafe;border-color:#72aee6}
.kcpw-quotes .kcpw-badge--approved{background:#e0f2f1;border-color:#00a0a0}
.kcpw-quotes .kcpw-badge--paid,.kcpw-quotes .kcpw-badge--completed{background:#d4edda;border-color:#46b450}
.kcpw-quotes .kcpw-badge--in_production{background:#e8dcf5;border-color:#8c6fc7}
.kcpw-quotes .kcpw-badge--declined,.kcpw-quotes .kcpw-badge--cancelled,.kcpw-quotes .kcpw-badge--expired{background:#f6e0e0;border-color:#d63638}
.kcpw-quotes .kcpw-attention{color:#8a1f11;font-weight:600}
.kcpw-quotes .kcpw-grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;align-items:start}
@media (max-width:960px){.kcpw-quotes .kcpw-grid{grid-template-columns:minmax(0,1fr)}}
.kcpw-quotes .postbox .inside{margin:0;padding:12px}
.kcpw-quotes dl.kcpw-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;margin:0}
.kcpw-quotes dl.kcpw-facts dt{font-weight:600}
.kcpw-quotes dl.kcpw-facts dd{margin:0;overflow-wrap:anywhere}
.kcpw-quotes .kcpw-desc{white-space:pre-wrap;background:#f6f7f7;padding:10px;border-radius:3px;margin:0}
.kcpw-quotes .kcpw-pictures{display:flex;flex-wrap:wrap;gap:12px;margin:0;padding:0;list-style:none}
.kcpw-quotes .kcpw-pictures img{display:block;max-width:150px;max-height:150px;border:1px solid #c3c4c7;background:#fff}
.kcpw-quotes .kcpw-field{margin:0 0 12px}
.kcpw-quotes .kcpw-field label{display:block;font-weight:600;margin-bottom:3px}
.kcpw-quotes .kcpw-field input[type=text],.kcpw-quotes .kcpw-field input[type=date],.kcpw-quotes .kcpw-field textarea,.kcpw-quotes .kcpw-field select{width:100%;max-width:100%}
.kcpw-quotes .kcpw-help{color:#50575e;margin:3px 0 0}
.kcpw-quotes .kcpw-row{display:flex;gap:12px}.kcpw-quotes .kcpw-row>div{flex:1}
.kcpw-quotes .kcpw-hl-pass{color:#1a7f37}.kcpw-quotes .kcpw-hl-warn{color:#8a6100}.kcpw-quotes .kcpw-hl-fail{color:#b32d2e}
</style>';
    }

    public function badge(string $status): string
    {
        return '<span class="kcpw-badge kcpw-badge--' . esc_attr($status) . '">' . self::h(Status::label($status)) . '</span>';
    }

    /** @param array{type:string,messages:list<string>}|null $notice */
    public function notice(?array $notice): string
    {
        if ($notice === null || $notice['messages'] === []) {
            return '';
        }
        $class = $notice['type'] === 'error' ? 'notice-error' : 'notice-success';
        $items = array_map(static fn (string $m): string => '<p>' . self::h($m) . '</p>', $notice['messages']);
        return '<div class="notice ' . $class . ' is-dismissible" role="status">' . implode('', $items) . '</div>';
    }

    /**
     * @param array<string,int> $counts
     * @param array{type:string,messages:list<string>}|null $notice
     */
    public function list(QuotePage $page, array $counts, int $attentionCount, string $status, string $search, bool $attentionOnly, ?array $notice): string
    {
        $total = array_sum($counts);
        $tabs = [];
        $tabs[] = $this->tab('All', $total, $status === '' && !$attentionOnly, $this->pageUrl());
        foreach (Status::LABELS as $key => $label) {
            $tabs[] = $this->tab($label, $counts[$key] ?? 0, $status === $key && !$attentionOnly, $this->pageUrl(['status' => $key]));
        }
        if ($attentionCount > 0 || $attentionOnly) {
            $tabs[] = $this->tab('Needs attention', $attentionCount, $attentionOnly, $this->pageUrl(['attention' => 1]));
        }
        $html = '<div class="wrap kcpw-quotes">' . self::styles();
        $html .= '<h1 class="wp-heading-inline">Custom Quotes</h1> <a class="page-title-action" href="' . $this->pageUrl(['view' => 'health']) . '">Setup check</a><hr class="wp-header-end">';
        $html .= $this->notice($notice);
        $html .= '<ul class="subsubsub">' . implode(' | ', $tabs) . '</ul>';
        $html .= '<form method="get" action="' . esc_url(admin_url('admin.php')) . '"><input type="hidden" name="page" value="' . self::PAGE . '">';
        if ($status !== '') {
            $html .= '<input type="hidden" name="status" value="' . esc_attr($status) . '">';
        }
        if ($attentionOnly) {
            $html .= '<input type="hidden" name="attention" value="1">';
        }
        $html .= '<p class="search-box"><label class="screen-reader-text" for="kcpw-quote-search">Search quotes</label>'
            . '<input type="search" id="kcpw-quote-search" name="s" value="' . esc_attr($search) . '" placeholder="Name, email, reference, game"> '
            . '<input type="submit" class="button" value="Search quotes"></p></form>';
        $html .= '<table class="wp-list-table widefat fixed striped"><caption class="screen-reader-text">Custom quote requests</caption><thead><tr>'
            . '<th scope="col" style="width:11em">Reference</th><th scope="col">Customer</th><th scope="col">Project</th><th scope="col" style="width:4em">Qty</th>'
            . '<th scope="col" style="width:9em">Status</th><th scope="col" style="width:8em">Quote total</th><th scope="col" style="width:9em">Offer expires</th><th scope="col" style="width:11em">Received</th></tr></thead><tbody>';
        if ($page->items === []) {
            $html .= '<tr><td colspan="8">' . ($search !== '' || $status !== '' || $attentionOnly ? 'No quotes match.' : 'No quote requests yet. They appear here when someone uses the form on your storefront.') . '</td></tr>';
        }
        foreach ($page->items as $quote) {
            $link = $this->pageUrl(['quote' => $quote->id()]);
            $flag = $quote->needsAttention() ? ' <span class="kcpw-attention" title="' . esc_attr($quote->attentionReason()) . '">Needs attention</span>' : '';
            $html .= '<tr><td><a href="' . $link . '"><strong>' . self::h($quote->ref()) . '</strong></a></td>'
                . '<td>' . self::h($quote->name()) . '<br><span class="description">' . self::h($quote->email()) . '</span></td>'
                . '<td>' . self::h(QuoteInput::PROJECT_TYPES[$quote->projectType()] ?? $quote->projectType()) . ($quote->game() !== '' ? '<br><span class="description">' . self::h($quote->game()) . '</span>' : '') . '</td>'
                . '<td>' . (int) $quote->quantity() . '</td>'
                . '<td>' . $this->badge($quote->status()) . $flag . '</td>'
                . '<td>' . ($quote->totalCents() > 0 ? self::h(Money::display($quote->totalCents(), $quote->currency())) : '&mdash;') . '</td>'
                . '<td>' . ($quote->status() === Status::QUOTED || $quote->status() === Status::EXPIRED ? self::h($this->settings->longDate($quote->expiresAt())) : '&mdash;') . '</td>'
                . '<td>' . self::h($this->settings->dateTime($quote->createdAt())) . '</td></tr>';
        }
        $html .= '</tbody></table>';
        if ($page->pages() > 1) {
            $args = array_filter(['status' => $status, 's' => $search, 'attention' => $attentionOnly ? '1' : '']);
            $html .= '<div class="tablenav bottom"><div class="tablenav-pages"><span class="displaying-num">' . (int) $page->total . ' quotes</span> ';
            for ($n = 1; $n <= $page->pages(); $n++) {
                $html .= $n === $page->page
                    ? '<span class="tablenav-pages-navspan button disabled" aria-current="page">' . $n . '</span> '
                    : '<a class="button" href="' . $this->pageUrl($args + ['paged' => $n]) . '">' . $n . '</a> ';
            }
            $html .= '</div></div>';
        }
        return $html . '</div>';
    }

    private function tab(string $label, int $count, bool $current, string $url): string
    {
        return '<li><a href="' . $url . '"' . ($current ? ' class="current" aria-current="page"' : '') . '>' . self::h($label) . ' <span class="count">(' . $count . ')</span></a></li>';
    }

    public function detail(AdminDetail $d): string
    {
        $q = $d->quote;
        $options = Admin::options($q);
        $html = '<div class="wrap kcpw-quotes">' . self::styles();
        $html .= '<h1 class="wp-heading-inline">' . self::h($q->ref()) . '</h1> ' . $this->badge($q->status())
            . ' <a class="page-title-action" href="' . $this->pageUrl() . '">All quotes</a><hr class="wp-header-end">';
        $html .= $this->notice($d->notice);
        if ($q->needsAttention()) {
            $html .= '<div class="notice notice-warning"><p><strong>Needs attention:</strong> ' . self::h($q->attentionReason()) . '</p>'
                . '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">' . $this->hidden('kcpw_quote_attention', $q->id())
                . '<p><button class="button">Mark as looked at</button></p></form></div>';
        }
        $html .= '<div class="kcpw-grid"><div>';
        $html .= $this->box('The request', $this->requestFacts($q));
        $html .= $this->box('Reference pictures', $this->pictures($d));
        $html .= $this->box('History', $this->history($d));
        $html .= '</div><div>';
        $html .= $this->box('Status', $this->statusForm($q, $options['statusTargets']));
        $html .= $this->box($options['canEditOffer'] ? 'Your quote' : 'The quote', $this->offer($d, $options));
        if ($q->orderId() > 0) {
            $html .= $this->box('Order', $this->orderBox($d));
        }
        $html .= $this->box('Email the customer', $this->emailForm($q));
        $html .= $this->box('Private notes', $this->notes($d));
        $html .= '</div></div></div>';
        return $html;
    }

    private function box(string $title, string $inside): string
    {
        return '<div class="postbox"><div class="postbox-header"><h2 class="hndle">' . self::h($title) . '</h2></div><div class="inside">' . $inside . '</div></div>';
    }

    private function hidden(string $action, int $id): string
    {
        return '<input type="hidden" name="action" value="' . esc_attr($action) . '"><input type="hidden" name="quote_id" value="' . $id . '">'
            . wp_nonce_field($action . '_' . $id, '_wpnonce', true, false);
    }

    private function requestFacts(Quote $q): string
    {
        $row = static fn (string $label, string $value): string => $value === '' ? '' : '<dt>' . self::h($label) . '</dt><dd>' . self::h($value) . '</dd>';
        $html = '<dl class="kcpw-facts">'
            . $row('Name', $q->name())
            . ($q->email() !== '' ? '<dt>Email</dt><dd><a href="mailto:' . esc_attr($q->email()) . '">' . self::h($q->email()) . '</a></dd>' : '')
            . $row('Received', $this->settings->dateTime($q->createdAt()))
            . $row('Project', QuoteInput::PROJECT_TYPES[$q->projectType()] ?? $q->projectType())
            . $row('Game or theme', $q->game())
            . $row('Quantity', (string) $q->quantity())
            . $row('Dimensions', $q->dimensions())
            . $row('Colors', $q->colors())
            . $row('Needed by', $q->deadline())
            . $row('Ships to', $q->shipTo())
            . $row('Phone', $q->phone());
        $address = json_decode($q->addressJson(), true);
        if (is_array($address) && $address !== []) {
            $html .= '<dt>Address (from approval)</dt><dd>' . implode('<br>', array_map(static fn ($v): string => self::h((string) $v), array_filter([
                $address['line1'] ?? '', $address['line2'] ?? '', trim(($address['city'] ?? '') . ', ' . ($address['state'] ?? '') . ' ' . ($address['postcode'] ?? ''), ' ,'), $address['country'] ?? '',
            ]))) . '</dd>';
        }
        $html .= '</dl>';
        $html .= '<h3>Description</h3><p class="kcpw-desc">' . self::h($q->description()) . '</p>';
        return $html;
    }

    private function pictures(AdminDetail $d): string
    {
        if ($d->files === []) {
            return '<p>No pictures were attached.</p>';
        }
        $html = '<ul class="kcpw-pictures">';
        foreach ($d->files as $file) {
            $url = esc_url(admin_url('admin-post.php?' . http_build_query(['action' => 'kcpw_quote_file', 'file' => $file->id, '_wpnonce' => wp_create_nonce('kcpw_quote_file_' . $file->id)])));
            $html .= '<li><a href="' . $url . '" target="_blank" rel="noopener noreferrer"><img src="' . $url . '" alt="' . esc_attr($file->displayName) . '" loading="lazy"></a><br>'
                . self::h($file->displayName) . '<br><span class="description">' . self::h(number_format($file->bytes / 1024, 0) . ' KB') . '</span></li>';
        }
        return $html . '</ul>';
    }

    /** @param list<string> $targets */
    private function statusForm(Quote $q, array $targets): string
    {
        $html = '<p>Now: ' . $this->badge($q->status()) . '</p>';
        if ($targets === []) {
            return $html . '<p class="kcpw-help">No manual change is possible from here. Approved and Paid are set by the customer\'s approval and by WooCommerce when the payment arrives.</p>';
        }
        $options = '';
        foreach ($targets as $target) {
            $options .= '<option value="' . esc_attr($target) . '">' . self::h(Status::label($target)) . '</option>';
        }
        $warn = $q->status() === Status::APPROVED ? '<p class="kcpw-help">Cancelling an approved quote also cancels its unpaid WooCommerce order.</p>' : '';
        if ($q->status() === Status::QUOTED) {
            $warn = '<p class="kcpw-help">Choosing any of these stops the customer\'s link from working.</p>';
        }
        return $html . '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">' . $this->hidden('kcpw_quote_status', $q->id())
            . '<div class="kcpw-field"><label for="kcpw-status-to">Change status to</label><select id="kcpw-status-to" name="status">' . $options . '</select></div>'
            . $warn . '<p><button class="button">Change status</button></p></form>';
    }

    /** @param array{canEditOffer:bool,canSend:bool,statusTargets:list<string>} $options */
    private function offer(AdminDetail $d, array $options): string
    {
        $q = $d->quote;
        if (!$options['canEditOffer'] && !$options['canSend']) {
            return $q->hasOffer() ? $this->offerSummary($q) : '<p>No quote was sent.</p>';
        }
        $f = $d->form;
        $html = '';
        if ($q->status() === Status::QUOTED || $q->status() === Status::APPROVED) {
            $html .= $this->offerSummary($q);
            $html .= '<p class="kcpw-help">Sent: ' . self::h($this->settings->dateTime($q->quotedAt())) . '. To change it, send a revised quote below: the customer gets a new link and the old one stops working.</p><hr>';
        }
        if (!$d->canSendLink) {
            $html .= '<div class="notice notice-error inline"><p>The storefront address is not set (KCPW_STOREFRONT_URL in wp-config.php), so a quote cannot be emailed yet. See Setup check.</p></div>';
        }
        $label = match ($q->status()) {
            Status::QUOTED => 'Send revised quote',
            Status::EXPIRED => 'Send revised quote',
            Status::APPROVED => 'Cancel the unpaid order and send a revised quote',
            default => 'Email quote to customer',
        };
        $val = static fn (string $k): string => esc_attr($f[$k] ?? '');
        $html .= '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">' . $this->hidden('kcpw_quote_send', $q->id())
            . '<div class="kcpw-field"><label for="kcpw-title">What you are offering</label><input type="text" id="kcpw-title" name="title" value="' . $val('title') . '" maxlength="120" required>'
            . '<p class="kcpw-help">Shown to the customer and on the order, for example "Custom case for Catan, two-tone".</p></div>'
            . '<div class="kcpw-field"><label for="kcpw-details">Details for the customer (optional)</label><textarea id="kcpw-details" name="details" rows="5" maxlength="4000">' . esc_textarea($f['details'] ?? '') . '</textarea>'
            . '<p class="kcpw-help">Materials, colors, timing. Included in the email and on the approval page.</p></div>'
            . '<div class="kcpw-row"><div class="kcpw-field"><label for="kcpw-item">Item price</label><input type="text" id="kcpw-item" name="item_price" inputmode="decimal" value="' . $val('item_price') . '" placeholder="45.00" required></div>'
            . '<div class="kcpw-field"><label for="kcpw-ship">Shipping</label><input type="text" id="kcpw-ship" name="shipping_price" inputmode="decimal" value="' . $val('shipping_price') . '" placeholder="8.50 (empty = free)"></div></div>'
            . '<div class="kcpw-field"><label for="kcpw-expires">Offer stands until</label><input type="date" id="kcpw-expires" name="expires" value="' . $val('expires') . '">'
            . '<p class="kcpw-help">The end of that day (' . self::h($this->settings->timezone) . '). Empty = ' . (int) $this->settings->validDays . ' days from now. Amounts are in ' . self::h($q->currency() !== '' ? $q->currency() : 'your store currency') . ($this->settings->taxable ? '; WooCommerce adds sales tax at payment.' : '; no tax is added: the total is what the customer pays.') . '</p></div>'
            . '<p><button class="button button-primary"' . ($d->canSendLink ? '' : ' disabled') . '>' . self::h($label) . '</button></p></form>';
        return $html;
    }

    private function offerSummary(Quote $q): string
    {
        $m = static fn (int $c): string => self::h(Money::display($c, $q->currency()));
        return '<dl class="kcpw-facts"><dt>Offer</dt><dd>' . self::h($q->title()) . '</dd>'
            . '<dt>Item</dt><dd>' . $m($q->itemCents()) . '</dd><dt>Shipping</dt><dd>' . ($q->shipCents() > 0 ? $m($q->shipCents()) : 'Free') . '</dd>'
            . '<dt>Total</dt><dd><strong>' . $m($q->totalCents()) . '</strong>' . ($q->taxable() ? ' plus tax' : '') . '</dd>'
            . '<dt>Revision</dt><dd>' . (int) $q->revision() . '</dd>'
            . ($q->expiresAt() > 0 ? '<dt>Stands until</dt><dd>' . self::h($this->settings->longDate($q->expiresAt())) . '</dd>' : '')
            . ($q->approvedAt() > 0 ? '<dt>Approved</dt><dd>' . self::h($this->settings->dateTime($q->approvedAt())) . ($q->status() === Status::APPROVED ? ', pay by ' . self::h($this->settings->dateTime($q->payBy())) : '') . '</dd>' : '')
            . ($q->paidAt() > 0 ? '<dt>Paid</dt><dd>' . self::h($this->settings->dateTime($q->paidAt())) . '</dd>' : '')
            . ($q->details() !== '' ? '<dt>Details</dt><dd class="kcpw-desc">' . self::h($q->details()) . '</dd>' : '')
            . '</dl>';
    }

    private function orderBox(AdminDetail $d): string
    {
        $q = $d->quote;
        $link = $d->orderLink !== '' ? '<a href="' . esc_url($d->orderLink) . '">Order #' . (int) $q->orderId() . '</a>' : 'Order #' . (int) $q->orderId();
        return '<p>' . $link . ($d->orderStatus !== '' ? ' &mdash; ' . self::h($d->orderStatus) : '') . '</p>'
            . '<p class="kcpw-help">Please do not change the amounts or add items to this order: the quote checks them when the payment arrives.</p>';
    }

    private function emailForm(Quote $q): string
    {
        if ($q->erased() || $q->email() === '') {
            return '<p>This customer\'s details were erased.</p>';
        }
        return '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">' . $this->hidden('kcpw_quote_email', $q->id())
            . '<div class="kcpw-field"><label for="kcpw-mail-subject">Subject</label><input type="text" id="kcpw-mail-subject" name="subject" maxlength="150" value="' . esc_attr('About your quote request ' . $q->ref()) . '" required></div>'
            . '<div class="kcpw-field"><label for="kcpw-mail-body">Message</label><textarea id="kcpw-mail-body" name="message" rows="5" maxlength="4000" required></textarea>'
            . '<p class="kcpw-help">Sent to ' . self::h($q->email()) . ' from your shop, with replies coming to ' . self::h($this->settings->notifyEmail) . '. Plain text. It does not contain a payment link.</p></div>'
            . '<p><button class="button">Send email</button></p></form>';
    }

    private function notes(AdminDetail $d): string
    {
        $html = '';
        foreach ($d->notes as $note) {
            $html .= '<div style="margin:0 0 10px;padding:0 0 10px;border-bottom:1px solid #dcdcde"><strong>' . self::h($note->author) . '</strong> <span class="description">' . self::h($this->settings->dateTime($note->createdAt)) . '</span>'
                . '<p class="kcpw-desc" style="margin-top:4px">' . self::h($note->note) . '</p></div>';
        }
        if ($html === '') {
            $html = '<p>No notes yet.</p>';
        }
        return $html . '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">' . $this->hidden('kcpw_quote_note', $d->quote->id())
            . '<div class="kcpw-field"><label for="kcpw-note">Add a note</label><textarea id="kcpw-note" name="note" rows="3" maxlength="4000" required></textarea>'
            . '<p class="kcpw-help">Only you and your staff see notes. They are never emailed or shown to the customer.</p></div><p><button class="button">Add note</button></p></form>';
    }

    private function history(AdminDetail $d): string
    {
        if ($d->events === []) {
            return '<p>Nothing yet.</p>';
        }
        $html = '<table class="widefat striped"><caption class="screen-reader-text">History</caption><thead><tr><th scope="col" style="width:11em">When</th><th scope="col" style="width:7em">Who</th><th scope="col">What</th></tr></thead><tbody>';
        foreach (array_reverse($d->events) as $e) {
            $who = $e->actor === 'customer' ? 'Customer' : ($e->actor === 'system' ? 'System' : (str_starts_with($e->actor, 'admin:') ? 'Staff' : $e->actor));
            $html .= '<tr><td>' . self::h($this->settings->dateTime($e->at)) . '</td><td>' . self::h($who) . '</td><td>' . self::h($e->detail) . '</td></tr>';
        }
        return $html . '</tbody></table>';
    }

    /** @param list<array{label:string,status:string,detail:string}> $checks */
    public function health(array $checks, ?array $notice): string
    {
        $icons = ['pass' => 'Ready', 'warn' => 'Check', 'fail' => 'Fix'];
        $html = '<div class="wrap kcpw-quotes">' . self::styles() . '<h1 class="wp-heading-inline">Custom Quotes: setup check</h1> <a class="page-title-action" href="' . $this->pageUrl() . '">All quotes</a><hr class="wp-header-end">';
        $html .= $this->notice($notice);
        $html .= '<p>This page only reports; it changes nothing. Real payments need your approval first: keep Stripe in test mode until then.</p>';
        $html .= '<table class="widefat striped" style="max-width:60rem"><caption class="screen-reader-text">Setup checks</caption><thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">What to do</th></tr></thead><tbody>';
        foreach ($checks as $check) {
            $html .= '<tr><td>' . self::h($check['label']) . '</td><td><strong class="kcpw-hl-' . esc_attr($check['status']) . '">' . self::h($icons[$check['status']] ?? $check['status']) . '</strong></td><td>' . self::h($check['detail']) . '</td></tr>';
        }
        $html .= '</tbody></table>';
        $html .= '<h2>Email</h2><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="kcpw_quote_testmail">'
            . wp_nonce_field('kcpw_quote_testmail', '_wpnonce', true, false)
            . '<p>Send a test email to ' . self::h($this->settings->notifyEmail) . ' to check that your site can send mail.</p><p><button class="button">Send a test email</button></p></form>';
        return $html . '</div>';
    }
}
