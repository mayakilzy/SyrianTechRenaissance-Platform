/**
 * STR Identity — Password Hashing (Argon2id)
 * ------------------------------------------
 * Uses Argon2id (the recommended variant) via @node-rs/argon2 (Rust binding,
 * no native compilation needed). Parameters follow OWASP recommendations
 * for interactive logins: m=19456 KiB (~19 MiB), t=2, p=1.
 *
 * See ADR-03 and 03-Data-and-Permissions §invariant 1.
 */

import { hash, verify } from "@node-rs/argon2";

// Algorithm.Argon2id = 2 (Argon2id is the recommended variant per RFC 9106).
// Using the numeric value directly because `isolatedModules` doesn't allow
// accessing const enums across module boundaries.
const OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456, // 19 MiB — OWASP recommended minimum
  timeCost: 2, // 2 iterations — OWASP recommended minimum
  parallelism: 1,
};

/** Hash a password. Returns a PHC-string that includes salt + params. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (password.length > 1024) {
    throw new Error("Password too long (max 1024 characters)");
  }
  return hash(password, OPTIONS);
}

/**
 * Verify a password against a stored PHC-string.
 * Returns false on mismatch (never throws for wrong password).
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await verify(storedHash, password);
  } catch {
    // Malformed hash or corrupted data — treat as mismatch, log separately.
    return false;
  }
}
