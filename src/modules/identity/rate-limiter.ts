/**
 * STR Identity — Rate Limiter
 * ---------------------------
 * In-memory sliding-window rate limiter for auth endpoints. Prevents brute-
 * force attacks on login, signup, password reset, and email verification
 * resend. Moves to Redis in production (ADR-02 notes no Redis on day one;
 * this is a G02 stopgap documented in the evidence report).
 *
 * Rate limits are keyed by IP + action to prevent one IP from exhausting the
 * global budget for one action. The limit is per (ip, action) pair.
 */

interface RateBucket {
  count: number;
  windowStart: number;
}

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 60_000, // 1 minute
};

export class RateLimiter {
  private buckets = new Map<string, RateBucket>();
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check and consume a rate-limit slot for (key, action).
   * Returns `allowed: false` when the bucket is exhausted.
   */
  check(key: string, action: string): RateLimitResult {
    const bucketKey = `${action}:${key}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const existing = this.buckets.get(bucketKey);
    if (!existing || existing.windowStart < windowStart) {
      // New window.
      this.buckets.set(bucketKey, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.config.maxAttempts - 1,
        resetAt: now + this.config.windowMs,
      };
    }

    if (existing.count >= this.config.maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.windowStart + this.config.windowMs,
      };
    }

    existing.count++;
    return {
      allowed: true,
      remaining: this.config.maxAttempts - existing.count,
      resetAt: existing.windowStart + this.config.windowMs,
    };
  }

  /** Clear buckets for a specific key+action (e.g., after successful login). */
  reset(key: string, action: string): void {
    this.buckets.delete(`${action}:${key}`);
  }

  /** Clear all expired buckets (call periodically to prevent memory growth). */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart < windowStart) {
        this.buckets.delete(key);
      }
    }
  }
}

/** Singleton instance for the app. */
let globalLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!globalLimiter) {
    globalLimiter = new RateLimiter();
    // Cleanup every 5 minutes.
    if (typeof setInterval !== "undefined") {
      setInterval(() => globalLimiter?.cleanup(), 300_000).unref?.();
    }
  }
  return globalLimiter;
}
