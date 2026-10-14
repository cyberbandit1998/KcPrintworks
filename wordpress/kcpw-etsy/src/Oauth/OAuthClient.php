<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\Transport;

/**
 * Authorization-code exchange and refresh against Etsy's token endpoint (To verify against the vendored spec:
 * endpoint, field names, and whether refresh tokens rotate; the code assumes they may, see TokenSource).
 */
final class OAuthClient
{
    /** @param callable():int $clock */
    public function __construct(
        private readonly OAuthConfig $config,
        private readonly Transport $transport,
        private $clock = null,
    ) {
        $this->clock = $clock ?? static fn (): int => time();
    }

    public function exchangeCode(string $code, string $codeVerifier): TokenSet
    {
        return $this->request([
            'grant_type' => 'authorization_code',
            'client_id' => $this->config->clientId,
            'redirect_uri' => $this->config->redirectUri,
            'code' => $code,
            'code_verifier' => $codeVerifier,
        ]);
    }

    public function refresh(TokenSet $current): TokenSet
    {
        return $this->request([
            'grant_type' => 'refresh_token',
            'client_id' => $this->config->clientId,
            'refresh_token' => $current->refreshToken,
        ]);
    }

    /** @param array<string,string> $form */
    private function request(array $form): TokenSet
    {
        $response = $this->transport->send(new Request(
            'POST',
            $this->config->tokenUrl,
            ['Content-Type' => 'application/x-www-form-urlencoded', 'Accept' => 'application/json'],
            http_build_query($form, '', '&', PHP_QUERY_RFC3986),
        ));

        if (!$response->ok()) {
            $error = $this->errorCode($response->body);
            if ($error === 'invalid_grant' || $response->status === 401) {
                throw new NeedsReauth('Etsy rejected the stored authorization. Reconnect the shop.');
            }
            throw new OAuthError(sprintf('Etsy token endpoint returned HTTP %d%s.', $response->status, $error !== '' ? ' (' . $error . ')' : ''));
        }

        try {
            $data = $response->json();
        } catch (\RuntimeException) {
            throw new OAuthError('Etsy token endpoint returned a response that is not JSON.');
        }
        foreach (['access_token', 'refresh_token', 'expires_in'] as $key) {
            if (!isset($data[$key])) {
                throw new OAuthError(sprintf('Etsy token response is missing "%s".', $key));
            }
        }
        $now = ($this->clock)();
        return new TokenSet((string) $data['access_token'], (string) $data['refresh_token'], $now + (int) $data['expires_in'], $this->config->scopes, $now);
    }

    private function errorCode(string $body): string
    {
        $data = json_decode($body, true);
        $code = is_array($data) ? ($data['error'] ?? '') : '';
        return is_string($code) ? preg_replace('/[^a-z_]/', '', strtolower($code)) ?? '' : '';
    }
}
