<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

final class OAuthConfig
{
    public const AUTHORIZE_URL = 'https://www.etsy.com/oauth/connect';
    public const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

    /** @var list<string> */
    public readonly array $scopes;

    /** @param list<string> $scopes */
    public function __construct(
        public readonly string $clientId,
        public readonly string $redirectUri,
        array $scopes,
        public readonly string $authorizeUrl = self::AUTHORIZE_URL,
        public readonly string $tokenUrl = self::TOKEN_URL,
    ) {
        if ($clientId === '') {
            throw new \InvalidArgumentException('The Etsy API key (keystring) is not configured.');
        }
        if (strncmp($redirectUri, 'https://', 8) !== 0) {
            throw new \InvalidArgumentException('The redirect URI must be https and registered exactly with Etsy.');
        }
        $this->scopes = Scopes::assertReadOnly($scopes);
    }
}
