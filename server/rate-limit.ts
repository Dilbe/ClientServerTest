// Counts attempts per key (an address or an account name) in memory, and
// says when a key has had too many. With a single server process, memory is
// enough; the counters disappear on their own, so no addresses are kept.

export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  /** Allows at most `maxAttempts` per key within any `windowMs` milliseconds. */
  constructor(maxAttempts: number, windowMs: number) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  /** Milliseconds until `key` may try again, or 0 when it may try now. */
  retryAfter(key: string, now = Date.now()): number {
    const times = this.recent(key, now);
    if (times.length < this.maxAttempts) return 0;
    return times[0]! + this.windowMs - now;
  }

  record(key: string, now = Date.now()): void {
    const times = this.recent(key, now);
    times.push(now);
    this.attempts.set(key, times);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Forgets keys without recent attempts, so the map can't grow forever. */
  prune(now = Date.now()): void {
    for (const key of this.attempts.keys()) {
      if (this.recent(key, now).length === 0) this.attempts.delete(key);
    }
  }

  private recent(key: string, now: number): number[] {
    const times = (this.attempts.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (times.length === 0) this.attempts.delete(key);
    return times;
  }
}
