<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Wp;

use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\Response;
use KcPrintworks\Etsy\Http\Transport;

/** HTTP through WordPress's own API (so proxies and the host's TLS settings apply). Always wrapped in ReadOnlyTransport. */
final class WpTransport implements Transport
{
    public function send(Request $request): Response
    {
        $args = [
            'method' => $request->method,
            'headers' => $request->headers,
            'timeout' => 15,
            'redirection' => 0,
            'sslverify' => true,
            'user-agent' => 'KCPrintWorks-Etsy-Sync/1 (read-only)',
        ];
        if ($request->body !== null) {
            $args['body'] = $request->body;
        }
        $result = \wp_remote_request($request->url, $args);
        if (\is_wp_error($result)) {
            // Status 0 is retryable transport failure for callers that care; the message never contains headers.
            return new Response(0, [], (string) \wp_json_encode(['error' => $result->get_error_message()]));
        }
        $headers = [];
        foreach ((array) \wp_remote_retrieve_headers($result) as $name => $value) {
            $headers[(string) $name] = is_array($value) ? implode(', ', $value) : (string) $value;
        }
        return new Response((int) \wp_remote_retrieve_response_code($result), $headers, (string) \wp_remote_retrieve_body($result));
    }
}
