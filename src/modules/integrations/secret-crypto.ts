/**
 * STR Integrations — Secret Encryption (G07)
 * ------------------------------------------
 * Encrypts/decrypts webhook signing secrets using AES-256-GCM.
 *
 * The encryption key comes from:
 *   1. process.env.INTEGRATION_ENCRYPTION_KEY (preferred, dedicated key)
 *   2. process.env.AUTH_SECRET (fallback, always available in CI)
 *
 * The plaintext secret is NEVER stored in the database. Only the
 * encrypted form (iv:ciphertext:authTag, base64) is stored.
 *
 * For production (G10): replace with a dedicated key manager (AWS KMS,
 * HashiCorp Vault, etc.). The interface (encrypt/decrypt) stays the same.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("No encryption key available (set INTEGRATION_ENCRYPTION_KEY or AUTH_SECRET)");
  }
  // Derive a 32-byte key from the raw secret using scrypt
  cachedKey = scryptSync(raw, "str-integration-salt", KEY_LENGTH);
  return cachedKey;
}

/**
 * Encrypt a plaintext secret. Returns a base64 string: iv:ciphertext:authTag
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), ciphertext.toString("base64"), authTag.toString("base64")].join(":");
}

/**
 * Decrypt an encrypted secret. Returns the plaintext.
 */
export function decryptSecret(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format (expected iv:ciphertext:authTag)");
  }
  const [ivB64, ciphertextB64, authTagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Production guard: prevents plaintext secret storage in production.
 * In production, the webhookSecret field MUST contain an encrypted value
 * (format: iv:ciphertext:authTag). This function throws if a plaintext
 * value is detected in production.
 */
export function assertEncryptedInProduction(value: string | null | undefined): void {
  if (process.env.NODE_ENV === "production" && value) {
    // Encrypted values have the format: base64:base64:base64 (3 parts)
    const parts = value.split(":");
    if (parts.length !== 3) {
      throw new Error(
        "CRITICAL: Plaintext webhook secret detected in production! " +
        "The value must be encrypted (format: iv:ciphertext:authTag). " +
        "Use encryptSecret() before storing.",
      );
    }
  }
}
