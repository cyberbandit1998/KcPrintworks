<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Admin;

use KcPrintworks\Etsy\Match\Entry;
use KcPrintworks\Etsy\Snapshot\RunState;
use KcPrintworks\Etsy\Sync\PlanEntry;
use KcPrintworks\Etsy\Sync\PlanItem;

/**
 * Server-rendered admin screens. Plain tables and forms: real captions and headers, every control labelled, status
 * shown as words as well as color, results announced through an aria-live region. All dynamic text is escaped.
 */
final class Views
{
    private const NOTICES = [
        'connected' => ['success', 'Connected to Etsy with read-only access.'],
        'disconnected' => ['success', 'Disconnected. The stored Etsy tokens were deleted.'],
        'not_configured' => ['error', 'The Etsy API key is not configured yet. Add it to wp-config.php (see the setup steps on this page).'],
        'etsy_declined' => ['error', 'Etsy did not grant access. Nothing was connected.'],
        'exchange_failed' => ['error', 'Etsy did not accept the connection request. Try Connect again; if it repeats, check the redirect address and the API key.'],
        'not_connected' => ['error', 'Connect to Etsy first.'],
        'tested' => ['success', 'The connection test finished. Results are below.'],
        'refresh_started' => ['success', 'Downloading your Etsy listings in the background. This page shows the progress.'],
        'decisions_saved' => ['success', 'Your decisions were saved. Nothing in WooCommerce was changed.'],
    ];

    public function __construct(private readonly Gateway $wp)
    {
    }

    public function layout(string $tab, string $body): string
    {
        $tabs = ['connection' => 'Connection', 'preview' => 'Import preview', 'plan' => 'Dry-run plan'];
        $nav = '';
        foreach ($tabs as $slug => $label) {
            $current = $slug === $tab ? ' aria-current="page"' : '';
            $class = $slug === $tab ? 'nav-tab nav-tab-active' : 'nav-tab';
            $nav .= '<a class="' . $class . '" href="' . Html::e($this->wp->adminUrl($slug)) . '"' . $current . '>' . Html::e($label) . '</a>';
        }
        $notice = '';
        $key = $this->wp->param('notice');
        if ($key !== null && isset(self::NOTICES[$key])) {
            [$type, $text] = self::NOTICES[$key];
            $extra = $key === 'decisions_saved' ? sprintf(' (%d saved, %d skipped)', (int) $this->wp->param('saved'), (int) $this->wp->param('skipped')) : '';
            $notice = '<div class="notice notice-' . Html::e($type) . '" role="status"><p>' . Html::e($text . $extra) . '</p></div>';
        }
        return '<div class="wrap"><h1>Etsy sync</h1>'
            . '<div class="notice notice-info inline"><p><strong>Read-only phase.</strong> This plugin only reads from Etsy and only reads your WooCommerce products. It cannot create, change, or delete a product, price, stock level, or order. Nothing is synchronized until you approve the first synchronization.</p></div>'
            . '<nav class="nav-tab-wrapper" aria-label="Etsy sync sections">' . $nav . '</nav>'
            . '<div aria-live="polite">' . $notice . '</div>'
            . $body . '</div>';
    }

    /** @param array<string,mixed> $vm */
    public function connection(array $vm): string
    {
        $h = '<h2>Connection</h2>';
        if ($vm['missing'] !== []) {
            $h .= '<div class="notice notice-warning inline"><p><strong>Setup needed.</strong> Add these to <code>wp-config.php</code>: '
                . implode(', ', array_map(static fn (string $c): string => '<code>' . Html::e($c) . '</code>', $vm['missing']))
                . '. Keep them out of the database and never paste them anywhere.</p></div>';
        }
        $h .= '<table class="widefat striped" style="max-width:48rem"><caption class="screen-reader-text">Connection status</caption><tbody>';
        $rows = [
            'Status' => $vm['connected'] ? 'Connected (read-only)' : 'Not connected',
            'Shop' => $vm['connected'] ? trim(($vm['shop_name'] ?? '') . ' ' . ($vm['shop_id'] ? '(shop ' . (int) $vm['shop_id'] . ')' : '')) : '-',
            'Permissions granted' => $vm['connected'] ? implode(', ', $vm['scopes']) : '-',
            'Access token valid until' => $vm['expires_at'] ?? '-',
            'Connected' => $vm['connected_at'] ?? '-',
            'Redirect address to register with Etsy' => $vm['callback_url'],
        ];
        foreach ($rows as $label => $value) {
            $h .= '<tr><th scope="row">' . Html::e($label) . '</th><td>' . ($label === 'Redirect address to register with Etsy' ? '<code>' . Html::e($value) . '</code>' : Html::e($value)) . '</td></tr>';
        }
        $h .= '</tbody></table>';

        $h .= '<p>';
        if (!$vm['connected']) {
            $h .= $this->postForm('kcpw_etsy_connect', 'Connect with Etsy', true);
        } else {
            $h .= $this->postForm('kcpw_etsy_test', 'Test connection') . ' ' . $this->postForm('kcpw_etsy_disconnect', 'Disconnect', false, 'Disconnect from Etsy and delete the stored tokens?');
        }
        $h .= '</p>';

        if ($vm['last_test'] !== null) {
            $h .= '<h3>Last connection test</h3><table class="widefat striped" style="max-width:60rem"><caption class="screen-reader-text">Connection test results</caption>'
                . '<thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead><tbody>';
            foreach ($vm['last_test']['checks'] as $check) {
                $label = ['pass' => 'Passed', 'warn' => 'Differs from expected', 'fail' => 'Failed'][$check['status']] ?? $check['status'];
                $h .= '<tr><td>' . Html::e($check['name']) . '</td><td><strong>' . Html::e($label) . '</strong></td><td>' . Html::e($check['detail']) . '</td></tr>';
            }
            $h .= '</tbody></table><p class="description">Run at ' . Html::e($vm['last_test']['at']) . '. A "differs" line means Etsy\'s real response is not exactly what this plugin was written to expect; send it to the developer before synchronizing.</p>';
        }

        $h .= '<h3>Setting up (once)</h3><ol>'
            . '<li>Register a <strong>Seller App</strong> in your Etsy developer account for the KCPrintWorks shop and copy its API key (keystring).</li>'
            . '<li>Register the redirect address shown above, exactly, as the app\'s callback URL.</li>'
            . '<li>Add <code>define(\'KCPW_ETSY_API_KEY\', \'...\');</code> to <code>wp-config.php</code>. If Etsy asks for the shared secret too, add <code>KCPW_ETSY_SHARED_SECRET</code> and set <code>KCPW_ETSY_SEND_SECRET</code> to <code>true</code>.</li>'
            . '<li>Add a long random <code>KCPW_ETSY_ENC_KEY</code> (32+ characters) so the stored tokens are encrypted with a key that is not in the database.</li>'
            . '<li>Return here and choose Connect with Etsy. Only the read permissions ' . Html::e(implode(', ', $vm['requested_scopes'])) . ' are requested.</li></ol>';
        return $this->layout('connection', $h);
    }

    /** @param array<string,mixed> $vm */
    public function preview(PreviewResult $result, RunState $run, array $vm): string
    {
        $c = $result->report->counts();
        $h = '<h2>Import preview</h2>';
        $h .= $this->runStatus($run, $vm);
        $h .= '<p>' . $this->postForm('kcpw_etsy_refresh', $run->running() ? 'Download again' : 'Download Etsy listings now', false, null, !$vm['connected']) . ' '
            . $this->downloadLink('kcpw_etsy_download_matches', 'Download matches (CSV)') . ' ' . $this->downloadLink('kcpw_etsy_download_snapshot', 'Download Etsy data (JSON)') . '</p>';

        $h .= '<table class="widefat striped" style="max-width:40rem"><caption>Where every Etsy listing stands</caption><thead><tr><th scope="col">Result</th><th scope="col">Listings</th></tr></thead><tbody>';
        $summary = [
            'Etsy listings downloaded' => $c['listings'],
            'Already mapped' => $c[Entry::MAPPED],
            'Approved by you' => $c[Entry::APPROVED] + $c[Entry::APPROVED_NEW],
            'Proposed, waiting for your approval' => $c[Entry::PROPOSED],
            'Ambiguous: you must choose' => $c[Entry::AMBIGUOUS],
            'New on Etsy (no website product found)' => $c[Entry::NEW],
            'Ignored by you' => $c[Entry::IGNORED],
            'WooCommerce products with no Etsy listing' => $c['woo_only'],
        ];
        foreach ($summary as $label => $count) {
            $h .= '<tr><th scope="row">' . Html::e($label) . '</th><td>' . (int) $count . '</td></tr>';
        }
        $h .= '</tbody></table>';

        $needs = array_values(array_filter($result->report->entries, static fn (Entry $e): bool => in_array($e->status, [Entry::AMBIGUOUS, Entry::PROPOSED, Entry::NEW, Entry::MAPPED_MISSING], true)));
        if ($needs === []) {
            $h .= '<p>' . ($c['listings'] === 0 ? 'No Etsy listings have been downloaded yet.' : 'Every listing is settled.') . '</p>';
            return $this->layout('preview', $h);
        }

        $h .= '<h3>Your decisions</h3><p class="description">Choose what each Etsy listing should be linked to. Saving only records your choice here. <strong>Nothing in WooCommerce changes.</strong> A title is never enough on its own, so title-only matches are listed for you to pick.</p>';
        $h .= '<form method="post" action="' . Html::e($this->wp->actionUrl('kcpw_etsy_decisions')) . '">' . $this->nonceField('kcpw_etsy_decisions');
        $h .= '<table class="widefat striped"><caption>Listings that need a decision</caption><thead><tr><th scope="col">Etsy listing</th><th scope="col">Status</th><th scope="col">Evidence and candidates</th><th scope="col">Your decision</th></tr></thead><tbody>';
        foreach ($needs as $e) {
            $h .= '<tr><td>' . Html::e($e->listing->title) . '<br><span class="description">#' . (int) $e->listing->id . ' (' . Html::e($e->listing->state) . ')</span></td>'
                . '<td>' . Html::e($this->statusLabel($e)) . '</td><td>' . $this->candidates($e, $result) . '</td><td>' . $this->decisionSelect($e, $result) . '</td></tr>';
        }
        $h .= '</tbody></table><p><button type="submit" class="button button-primary">Save decisions</button></p></form>';
        return $this->layout('preview', $h);
    }

    /** @param array<string,mixed> $vm */
    public function plan(PreviewResult $result, array $vm): string
    {
        $t = $result->plan->totals();
        $h = '<h2>Dry-run plan</h2><p>This is what a synchronization <strong>would</strong> do, field by field. Nothing has been done. Etsy owns titles, descriptions, images, variations (including colors), and base prices. The website keeps its own URLs, categories, shipping, tax, and SEO.</p>';
        $h .= '<p>' . Html::e(sprintf('%d products in the plan: %d approved, %d preview only, %d with proposed changes, %d with conflicts, %d new drafts. Fingerprint %s.', $t['entries'], $t['approved'], $t['preview_only'], $t['with_changes'], $t['conflicts'], $t['create_draft'], substr($result->plan->hash(), 0, 12))) . '</p>';
        foreach ($result->plan->entries as $entry) {
            if (!$entry->hasChanges() && $entry->action !== PlanEntry::CREATE_DRAFT) {
                continue;
            }
            $h .= '<details><summary>' . Html::e('#' . $entry->listingId . ' ' . $entry->listingTitle . ($entry->approved ? '' : ' (preview only: not approved)') . ($entry->action === PlanEntry::CREATE_DRAFT ? ' (new draft)' : '')) . '</summary>';
            $h .= '<table class="widefat striped"><caption class="screen-reader-text">Planned changes for listing ' . (int) $entry->listingId . '</caption><thead><tr><th scope="col">Field</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Website now</th><th scope="col">After</th><th scope="col">Risk</th><th scope="col">Note</th></tr></thead><tbody>';
            foreach ($entry->items as $item) {
                if ($item->status === PlanItem::UNTOUCHED || $item->status === PlanItem::IN_SYNC) {
                    continue;
                }
                $h .= '<tr><td>' . Html::e($item->field) . '</td><td>' . Html::e($item->owner) . '</td><td>' . Html::e($item->status) . '</td><td>' . Html::e($this->short($item->before)) . '</td><td>' . Html::e($this->short($item->after)) . '</td><td>' . Html::e($item->risk) . '</td><td>' . Html::e($item->note) . '</td></tr>';
            }
            $h .= '</tbody></table></details>';
        }
        return $this->layout('plan', $h);
    }

    /** @param array<string,mixed> $vm */
    private function runStatus(RunState $run, array $vm): string
    {
        $labels = [RunState::IDLE => 'No download yet', RunState::LISTING => 'Listing your Etsy products', RunState::DETAILS => 'Downloading details', RunState::DONE => 'Finished', RunState::FAILED => 'Failed', RunState::PAUSED => 'Paused (API budget)'];
        $h = '<table class="widefat striped" style="max-width:40rem"><caption class="screen-reader-text">Last download</caption><tbody>'
            . '<tr><th scope="row">Last download</th><td>' . Html::e($labels[$run->phase] ?? $run->phase) . '</td></tr>'
            . '<tr><th scope="row">Started</th><td>' . Html::e($run->startedAt !== '' ? $run->startedAt : '-') . '</td></tr>'
            . '<tr><th scope="row">Finished</th><td>' . Html::e($run->finishedAt !== '' ? $run->finishedAt : '-') . '</td></tr>'
            . '<tr><th scope="row">Listings / details / failed</th><td>' . (int) $run->listings . ' / ' . (int) $run->detailsDone . ' / ' . (int) $run->detailsFailed . '</td></tr>';
        if (($run->quota['remaining_today'] ?? null) !== null) {
            $h .= '<tr><th scope="row">Etsy API requests left today</th><td>' . (int) $run->quota['remaining_today'] . ' of ' . (int) ($run->quota['limit_per_day'] ?? 0) . '</td></tr>';
        }
        $h .= '</tbody></table>';
        if ($run->errors !== []) {
            $h .= '<div class="notice notice-warning inline"><p><strong>Problems:</strong></p><ul>';
            foreach (array_slice($run->errors, -10) as $error) {
                $h .= '<li>' . Html::e($error) . '</li>';
            }
            $h .= '</ul></div>';
        }
        if ($run->running()) {
            $h .= '<meta http-equiv="refresh" content="8">';
        }
        return $h;
    }

    private function statusLabel(Entry $e): string
    {
        return match ($e->status) {
            Entry::PROPOSED => $e->evidence === Entry::EVIDENCE_IDENTIFIER ? 'Proposed (identifier match)' : 'Proposed (same title and description: review)',
            Entry::AMBIGUOUS => match ($e->reason) {
                Entry::REASON_DUPLICATES => 'Ambiguous: several matching products',
                Entry::REASON_TITLE_ONLY => 'Ambiguous: only the title agrees',
                Entry::REASON_CLAIMED => 'Ambiguous: product claimed by two listings',
                Entry::REASON_INVALID_DECISION => 'Your earlier decision no longer applies',
                default => 'Ambiguous',
            },
            Entry::NEW => 'New on Etsy',
            Entry::MAPPED_MISSING => 'Mapped product is missing',
            default => $e->status,
        };
    }

    private function candidates(Entry $e, PreviewResult $result): string
    {
        $h = '<ul>';
        foreach ($e->candidates as $c) {
            $woo = $result->report->wooById[$c->wooId] ?? null;
            $h .= '<li>' . Html::e('#' . $c->wooId . ' ' . ($woo?->title ?? '') . ' (' . ($woo?->status ?? '?') . ', score ' . $c->score . ': ' . implode(', ', $c->signalTypes()) . ')') . '</li>';
        }
        $h .= '</ul>';
        foreach ($e->notes as $note) {
            $h .= '<p class="description">' . Html::e($note) . '</p>';
        }
        return $h;
    }

    private function decisionSelect(Entry $e, PreviewResult $result): string
    {
        $id = 'decision-' . (int) $e->listing->id;
        $h = '<label class="screen-reader-text" for="' . Html::e($id) . '">Decision for Etsy listing ' . (int) $e->listing->id . '</label>';
        $h .= '<select id="' . Html::e($id) . '" name="decision[' . (int) $e->listing->id . ']"><option value="keep">Decide later</option>';
        $seen = [];
        $options = [];
        if ($e->suggestedWooId !== null) {
            $options[] = $e->suggestedWooId;
        }
        if ($e->wooId !== null) {
            $options[] = $e->wooId;
        }
        foreach ($e->candidates as $c) {
            $options[] = $c->wooId;
        }
        foreach ($options as $wooId) {
            if (isset($seen[$wooId])) {
                continue;
            }
            $seen[$wooId] = true;
            $woo = $result->report->wooById[$wooId] ?? null;
            $suffix = $wooId === $e->suggestedWooId ? ' (suggested)' : '';
            $h .= '<option value="link:' . (int) $wooId . '">Link to #' . (int) $wooId . ' ' . Html::e(mb_substr($woo?->title ?? '', 0, 40)) . Html::e($suffix) . '</option>';
        }
        $h .= '<option value="create_new">None of these: it is a new product</option><option value="ignore">Ignore this listing</option><option value="clear">Clear my earlier decision</option></select>';
        return $h;
    }

    private function postForm(string $action, string $label, bool $primary = false, ?string $confirm = null, bool $disabled = false): string
    {
        $class = $primary ? 'button button-primary' : 'button';
        $onsubmit = $confirm !== null ? ' onsubmit="return confirm(' . Html::e(json_encode($confirm)) . ')"' : '';
        return '<form method="post" style="display:inline" action="' . Html::e($this->wp->actionUrl($action)) . '"' . $onsubmit . '>'
            . $this->nonceField($action) . '<button type="submit" class="' . $class . '"' . ($disabled ? ' disabled' : '') . '>' . Html::e($label) . '</button></form>';
    }

    private function downloadLink(string $action, string $label): string
    {
        $nonceAction = 'kcpw_etsy_download';
        return '<a class="button" href="' . Html::e($this->wp->actionUrl($action, ['_wpnonce' => $this->wp->nonce($nonceAction)])) . '">' . Html::e($label) . '</a>';
    }

    private function nonceField(string $action): string
    {
        return '<input type="hidden" name="_wpnonce" value="' . Html::e($this->wp->nonce($action)) . '">';
    }

    private function short(mixed $value): string
    {
        if ($value === null) {
            return '-';
        }
        $text = is_scalar($value) ? (string) $value : (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return mb_strlen($text) > 120 ? mb_substr($text, 0, 117) . '...' : $text;
    }
}
