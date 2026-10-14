<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Http;

/** The only way the plugin talks to the network. Real code uses WordPress's HTTP API; tests use a fake. */
interface Transport
{
    public function send(Request $request): Response;
}
