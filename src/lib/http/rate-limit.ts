/**
 * In-memory sliding-window rate limiter.
 * Good enough for a single Node process. Behind multiple instances, put the limit at the reverse proxy / CDN
 * or swap this class for a Redis-backed implementation with the same interface.
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** seconds until a request would be allowed again (0 when allowed) */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string): RateLimitResult {
    const t = this.now();
    this.sweep(t);
    const from = t - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return { allowed: false, limit: this.limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((list[0] + this.windowMs - t) / 1000)) };
    }
    list.push(t);
    this.hits.set(key, list);
    return { allowed: true, limit: this.limit, remaining: this.limit - list.length, retryAfterSeconds: 0 };
  }

  private sweep(t: number) {
    if (t - this.lastSweep < this.windowMs && this.hits.size < this.maxKeys) return;
    this.lastSweep = t;
    const from = t - this.windowMs;
    for (const [k, v] of this.hits) {
      if (v.length === 0 || v[v.length - 1] <= from) this.hits.delete(k);
    }
    // hard cap: drop oldest keys so a flood of unique IPs cannot exhaust memory
    if (this.hits.size >= this.maxKeys) {
      const drop = this.hits.size - this.maxKeys + 1;
      let i = 0;
      for (const k of this.hits.keys()) {
        if (i++ >= drop) break;
        this.hits.delete(k);
      }
    }
  }
}
