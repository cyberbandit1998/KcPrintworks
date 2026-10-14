<?php
declare(strict_types=1);

namespace KcPrintworks\Core\Tests;

use KcPrintworks\Core\Reviews\ReviewGateway;

/** A gateway whose answers a test chooses, and which records what the service did. */
final class FakeReviewGateway implements ReviewGateway
{
    public bool $enabled = true;
    public string $state = self::PRODUCT_OPEN;
    public bool $verifiedOnly = false;
    /** @var list<string> */
    public array $owners = [];
    /** @var list<string> */
    public array $reviewers = [];
    /** @var array<string,int> */
    public array $counts = [];
    /** @var list<array{int,int,string,string,string}> */
    public array $inserted = [];
    public int $insertResult = 900;
    public int $lookups = 0;

    public function reviewsEnabled(): bool { return $this->enabled; }
    public function productState(int $productId): string { $this->lookups++; return $this->state; }
    public function verifiedOwnersOnly(): bool { return $this->verifiedOnly; }
    public function isVerifiedOwner(string $email, int $productId): bool { return in_array($email, $this->owners, true); }
    public function hasReview(int $productId, string $email): bool { return in_array($email, $this->reviewers, true); }
    public function attempts(string $key): int { return $this->counts[$key] ?? 0; }
    public function recordAttempt(string $key, int $windowSeconds): void { $this->counts[$key] = ($this->counts[$key] ?? 0) + 1; }

    public function insertPending(int $productId, int $rating, string $name, string $email, string $text): int
    {
        $this->inserted[] = [$productId, $rating, $name, $email, $text];
        return $this->insertResult;
    }
}
