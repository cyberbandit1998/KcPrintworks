<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Api;

/** HTTP 403: the app or token lacks the scope, or the Seller App is not approved for this shop. */
final class AccessDenied extends ApiError
{
}
