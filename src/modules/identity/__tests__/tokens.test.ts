import { describe, it, expect } from "vitest";
import { generateToken, hashToken, constantTimeCompare } from "@/modules/identity/tokens";

describe("Token generation and hashing", () => {
  it("generates a URL-safe base64 token of sufficient length", () => {
    const token = generateToken();
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThanOrEqual(40);
    // URL-safe base64 alphabet only
    expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
  });

  it("generates unique tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateToken());
    }
    expect(tokens.size).toBe(100);
  });

  it("hashes a token deterministically (same token → same hash)", () => {
    const token = generateToken();
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different tokens", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(hashToken(t1)).not.toBe(hashToken(t2));
  });

  it("hash is a 64-char hex string (SHA-256)", () => {
    const hash = hashToken(generateToken());
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("constantTimeCompare: equal strings return true", () => {
    expect(constantTimeCompare("abc123", "abc123")).toBe(true);
  });

  it("constantTimeCompare: different strings return false", () => {
    expect(constantTimeCompare("abc123", "abc124")).toBe(false);
  });

  it("constantTimeCompare: different lengths return false", () => {
    expect(constantTimeCompare("abc", "abcd")).toBe(false);
  });
});
