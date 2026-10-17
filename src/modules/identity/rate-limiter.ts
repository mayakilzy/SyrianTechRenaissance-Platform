/**
 * STR Identity — Rate Limiter (G02 stopgap, single-instance only)
 * ----------------------------------------------------------------
 * In-memory sliding-window rate limiter for auth endpoints. Prevents brute-
 * force attacks on login, signup, password reset, and email verification
 * resend.
 *
 * ⚠️  CRITICAL LIMITATION — SINGLE-INSTANCE ONLY:
 * This implementation uses a process-local `Map`. It does NOT provide
 * uniform rate limiting across multiple app instances, replicas, or
 * serverless deployments. If the app runs behind a load balancer with N
 * replicas, an attacker can make N × maxAttempts requests per window.
 *
 * Production readiness requires a shared store (Redis, Upstash, or a
 * PostgreSQL-backed counter). This is deferred per ADR-02 (no Redis on
 * day one) and ADR-05 (sandbox has no shared store). The migration path:
 *   1. Replace `RateLimiter` with a `RedisRateLimiter` implementation.
 *   2. Keep the same `check(key, action)` interface so callers don't change.
 *   3. Wire it in `getRateLimiter()` based on an env flag.
 *
 * G02 acceptance: this limiter is ACCEPTED for single-instance staging and
 * CI, but is NOT claimed as production-ready. Production deployment (G10)
 * must replace it before go-live.
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
   *
   * NOTE: Only accurate for the current process. See file header.
   */
  check(key: string, action: string): RateLimitResult {
    const bucketKey = `${action}:${key}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const existing = this.buckets.get(bucketKey);
    if (!existing || existing.windowStart < windowStart) {
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

/** Singleton instance for the app. See file header for single-instance caveat. */
let globalLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!globalLimiter) {
    globalLimiter = new RateLimiter();
    if (typeof setInterval !== "undefined") {
      setInterval(() => globalLimiter?.cleanup(), 300_000).unref?.();
    }
  }
  return globalLimiter;
}
