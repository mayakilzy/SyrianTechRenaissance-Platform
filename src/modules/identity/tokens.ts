/**
 * STR Identity — Secure Token Generation & Hashing
 * -----------------------------------------------
 * Verification and reset tokens are random 256-bit values encoded as URL-safe
 * base64. We store ONLY the SHA-256 hash in the database; the raw token is
 * sent to the user via email. This means:
 *   - A DB leak does not expose usable tokens.
 *   - The raw token is single-use (consumed on verification).
 *   - Lookup by token is O(1) via the unique hash index.
 *
 * See 03-Data-and-Permissions §invariant 5 (immutable revisions) and
 *     Engineering Playbook §"tracked migrations, restore-tested backups".
 */

import { randomBytes, createHash } from "node:crypto";

/** Generate a cryptographically secure random token (URL-safe base64, 43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash a token with SHA-256. Store this hash; never store the raw token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two hex-encoded hashes. */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
