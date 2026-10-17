import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "@/modules/identity/rate-limiter";

describe("Rate limiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ maxAttempts: 3, windowMs: 1000 });
  });

  it("allows up to maxAttempts requests", () => {
    expect(limiter.check("ip1", "signup").allowed).toBe(true);
    expect(limiter.check("ip1", "signup").allowed).toBe(true);
    expect(limiter.check("ip1", "signup").allowed).toBe(true);
  });

  it("blocks after exceeding maxAttempts", () => {
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    const result = limiter.check("ip1", "signup");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("tracks different actions independently", () => {
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    // signup exhausted, but login should still be allowed
    expect(limiter.check("ip1", "login").allowed).toBe(true);
  });

  it("tracks different IPs independently", () => {
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    // ip1 exhausted, but ip2 should still be allowed
    expect(limiter.check("ip2", "signup").allowed).toBe(true);
  });

  it("reset clears the bucket for a key+action", () => {
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    expect(limiter.check("ip1", "signup").allowed).toBe(false);
    limiter.reset("ip1", "signup");
    expect(limiter.check("ip1", "signup").allowed).toBe(true);
  });

  it("remaining count decrements correctly", () => {
    const r1 = limiter.check("ip1", "signup");
    expect(r1.remaining).toBe(2);
    const r2 = limiter.check("ip1", "signup");
    expect(r2.remaining).toBe(1);
    const r3 = limiter.check("ip1", "signup");
    expect(r3.remaining).toBe(0);
  });

  it("resetAt is in the future when blocked", () => {
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    limiter.check("ip1", "signup");
    const blocked = limiter.check("ip1", "signup");
    expect(blocked.resetAt).toBeGreaterThan(Date.now());
  });
});
