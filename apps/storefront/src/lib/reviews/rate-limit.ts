/**
 * A small in-memory sliding-window limiter (one container, like the rest of the server's caches; several containers would each count
 * on their own, which is still a limit). The number of remembered keys is capped so a flood of different addresses cannot grow memory.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts this attempt and says whether it is allowed. When it is not, `retryAfterSeconds` is when the oldest counted attempt expires. */
  hit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.delete(key);
      this.hits.set(key, recent); // keep it fresh in the insertion order
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    return { allowed: true };
  }

  size(): number {
    return this.hits.size;
  }
}
