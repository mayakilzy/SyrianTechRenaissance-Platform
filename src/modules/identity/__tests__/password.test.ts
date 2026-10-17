import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/modules/identity/password";

describe("Password hashing (Argon2id)", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("testPassword123");
    expect(hash).toBeTruthy();
    expect(hash).not.toBe("testPassword123");
    expect(hash.startsWith("$argon2id$")).toBe(true);

    const valid = await verifyPassword("testPassword123", hash);
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correctPassword");
    const valid = await verifyPassword("wrongPassword", hash);
    expect(valid).toBe(false);
  });

  it("rejects short passwords", async () => {
    await expect(hashPassword("short")).rejects.toThrow("at least 8 characters");
  });

  it("rejects passwords over 1024 chars", async () => {
    const long = "a".repeat(1025);
    await expect(hashPassword(long)).rejects.toThrow("too long");
  });

  it("produces different hashes for the same password (salt)", async () => {
    const h1 = await hashPassword("samePassword123");
    const h2 = await hashPassword("samePassword123");
    expect(h1).not.toBe(h2);
  });

  it("returns false for malformed stored hash", async () => {
    const valid = await verifyPassword("anything", "not-a-valid-hash");
    expect(valid).toBe(false);
  });

  it("returns false for empty stored hash", async () => {
    const valid = await verifyPassword("anything", "");
    expect(valid).toBe(false);
  });
});
