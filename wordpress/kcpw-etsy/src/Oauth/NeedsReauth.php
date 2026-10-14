<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Oauth;

/** The stored grant is dead (revoked, expired, or rejected). Jobs pause; the admin must reconnect. */
final class NeedsReauth extends \RuntimeException
{
}
