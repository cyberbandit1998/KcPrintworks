<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/** What the admin is sent to, and what must be remembered (server-side) until Etsy sends them back. */
final class AuthorizationRequest
{
    public function __construct(
        public readonly string $url,
        public readonly string $state,
        public readonly string $codeVerifier,
    ) {
    }

    public static function begin(OAuthConfig $config): self
    {
        $verifier = Pkce::verifier();
        $state = Pkce::state();
        $query = http_build_query([
            'response_type' => 'code',
            'client_id' => $config->clientId,
            'redirect_uri' => $config->redirectUri,
            'scope' => implode(' ', $config->scopes),
            'state' => $state,
            'code_challenge' => Pkce::challenge($verifier),
            'code_challenge_method' => 'S256',
        ], '', '&', PHP_QUERY_RFC3986);
        return new self($config->authorizeUrl . '?' . $query, $state, $verifier);
    }
}
