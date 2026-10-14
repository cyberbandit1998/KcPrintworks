<?php
declare(strict_types=1);

namespace KcPrintworks\Etsy\Tests;

use KcPrintworks\Etsy\Http\Request;
use KcPrintworks\Etsy\Http\Response;
use KcPrintworks\Etsy\Http\Transport;

/** Answers from a queue or a route function, and records every request for assertions. */
final class FakeTransport implements Transport
{
    /** @var list<Request> */
    public array $requests = [];

    /** @var list<Response> */
    private array $queue = [];

    /** @var (callable(Request):Response)|null */
    private $router;

    /** @param (callable(Request):Response)|null $router */
    public function __construct(?callable $router = null)
    {
        $this->router = $router;
    }

    public function queue(Response ...$responses): self
    {
        foreach ($responses as $r) {
            $this->queue[] = $r;
        }
        return $this;
    }

    public function send(Request $request): Response
    {
        $this->requests[] = $request;
        if ($this->queue !== []) {
            return array_shift($this->queue);
        }
        if ($this->router !== null) {
            return ($this->router)($request);
        }
        throw new \LogicException('FakeTransport has no response queued for ' . $request->method . ' ' . $request->url);
    }

    public static function json(array $data, int $status = 200, array $headers = []): Response
    {
        return new Response($status, $headers + ['content-type' => 'application/json'], (string) json_encode($data));
    }
}
