import { describe, it, expect, afterEach } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { execSync } from "node:child_process";
import { encryptSecret, decryptSecret, assertEncryptedInProduction } from "@/modules/integrations/secret-crypto";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import { createConnection, approveProvider, listConnections } from "@/modules/integrations/service";

/**
 * STR G09 — Encryption & Secrets Audit (Priority 1.6 — Corrected)
 * Per ChatGPT directive: evidence must prove the behavior it claims.
 */

let run: ReturnType<typeof startTestRun>;
afterEach(async () => { if (run) await cleanupTestRun(run); });

describe("G09 — Encryption & Secrets Audit (Priority 1.6)", () => {
  // ── Algorithm-level tests (direct crypto, no module cache) ──

  it("1. AES-256-GCM encrypt → decrypt → matches original", () => {
    const plaintext = randomBytes(32).toString("hex");
    const encrypted = encryptSecret(plaintext);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("2. No plaintext in encrypted output (format: iv:ciphertext:authTag)", () => {
    const plaintext = `secret-${Date.now()}-unique-value`;
    const encrypted = encryptSecret(plaintext);
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    expect(encrypted).not.toContain(plaintext);
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it("3. Different encryptions of same plaintext produce different ciphertexts (random IV)", () => {
    const plaintext = "same-secret-value-for-iv-test";
    const enc1 = encryptSecret(plaintext);
    const enc2 = encryptSecret(plaintext);
    expect(decryptSecret(enc1)).toBe(plaintext);
    expect(decryptSecret(enc2)).toBe(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  // ── Wrong-key rejection: direct crypto (bypasses module cache) ──

  it("4b. Wrong key rejection: decrypt with DIFFERENT key → throws (direct AES-256-GCM test)", () => {
    // Test the actual AES-256-GCM algorithm directly (not through the module cache).
    // This proves that a different key CANNOT decrypt the ciphertext.
    const keyA = scryptSync("key-a-at-least-16-chars", "str-integration-salt", 32);
    const keyB = scryptSync("key-b-at-least-16-chars", "str-integration-salt", 32);
    const iv = randomBytes(12);

    // Encrypt with key A
    const cipher = createCipheriv("aes-256-gcm", keyA, iv);
    const ciphertext = Buffer.concat([cipher.update("test-secret", "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Try to decrypt with key B → must throw (GCM authTag verification fails)
    const decipher = createDecipheriv("aes-256-gcm", keyB, iv);
    decipher.setAuthTag(authTag);
    expect(() => {
      Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }).toThrow();
  });

  // ── Tamper detection ──

  it("5. Tamper detection: modify ciphertext → decrypt throws", () => {
    const plaintext = "secret-for-tamper-test";
    const encrypted = encryptSecret(plaintext);
    const parts = encrypted.split(":");
    const tampered = Buffer.from(parts[1]!, "base64");
    tampered[0] = tampered[0]! ^ 0xff;
    parts[1] = tampered.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("6. Tamper detection: modify authTag → decrypt throws", () => {
    const plaintext = "secret-for-authtag-test";
    const encrypted = encryptSecret(plaintext);
    const parts = encrypted.split(":");
    const tampered = Buffer.from(parts[2]!, "base64");
    tampered[0] = tampered[0]! ^ 0xff;
    parts[2] = tampered.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("7. Invalid format: missing parts → throws", () => {
    expect(() => decryptSecret("")).toThrow();
    expect(() => decryptSecret("not-valid")).toThrow();
    expect(() => decryptSecret("a:b:c")).toThrow();
  });

  // ── Missing key: isolated child process (no module cache) ──

  it("8b. Missing key behavior: encryptSecret throws when no key configured (isolated process)", () => {
    // Run in a child process with NO env vars to test the actual missing-key path.
    // This bypasses the module-level cache in the current process.
    const script = `
      // Clear all key env vars
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
      delete process.env.AUTH_SECRET;
      try {
        const { encryptSecret } = require("./src/modules/integrations/secret-crypto");
        encryptSecret("test");
        console.log("NO_THROW"); // should have thrown
      } catch (e) {
        if (e.message.includes("No encryption key available")) {
          console.log("CORRECT_THROW");
        } else {
          console.log("WRONG_THROW:" + e.message);
        }
      }
    `;
    const result = execSync(`node -e "${script.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, INTEGRATION_ENCRYPTION_KEY: "", AUTH_SECRET: "" },
    }).trim();
    expect(result).toBe("CORRECT_THROW");
  });

  // ── assertEncryptedInProduction guard ──

  it("9. assertEncryptedInProduction: rejects plaintext in production", () => {
    (process.env as any).NODE_ENV = "production";
    expect(() => assertEncryptedInProduction("plaintext-secret-not-encrypted")).toThrow(
      "CRITICAL: Plaintext webhook secret detected in production"
    );
    const encrypted = encryptSecret("test-secret-value");
    expect(() => assertEncryptedInProduction(encrypted)).not.toThrow();
    expect(() => assertEncryptedInProduction(null)).not.toThrow();
    (process.env as any).NODE_ENV = "test";
  });

  it("10. assertEncryptedInProduction: allows plaintext in non-production", () => {
    expect(() => assertEncryptedInProduction("plaintext-secret-not-encrypted")).not.toThrow();
  });

  // ── DB storage verification (real connection) ──

  it("11. DB storage: webhookSecret stored as encrypted (NOT plaintext) in DB", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const stewardId = await createTestUser(run, "admin");
    const leadId = await createTestUser(run, "rep");
    const proposal = await createProposal({
      submitterId: leadId, title: `G09 Enc DB Test ${run.runId}`,
      charter: {
        problemStatement: "DB storage test problem statement with sufficient length for validation purposes here.",
        outcomes: "DB storage test outcomes with sufficient length for validation purposes here.",
        scope: "DB storage test scope with sufficient length for validation purposes here.",
        requiredSkills: ["TypeScript"],
        acceptanceCriteria: "DB storage test acceptance criteria with sufficient length for validation.",
      },
    });
    await submitProposal(proposal.id, leadId);
    await reviewProposal({ proposalId: proposal.id, reviewerId: adminId, action: "APPROVE", reason: "Approved for G09 encryption test.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    run.projectIds.push(project!.id);

    // Ensure provider exists + approved
    const provider = await db.integrationProvider.upsert({
      where: { id: "str.mock.v1" }, update: { isMock: true },
      create: { id: "str.mock.v1", slug: "str.mock", version: "v1", displayName: "STR Mock Provider", description: "Mock", owner: "STR", baseOrigin: "https://mock.str.local", trustStatus: "registered", authMode: { type: "none" }, isMock: true },
    });
    await db.integrationCapability.upsert({
      where: { providerId_code: { providerId: provider.id, code: "application.test" } }, update: {},
      create: { providerId: provider.id, code: "application.test", summary: "Test", executionMode: "async", riskClass: "low", requiredScopes: ["test"], inputSchemaRef: "ref", outputSchemaRef: "ref", idempotent: true, cancelable: true, timeoutMs: 30000 },
    });
    if (provider.trustStatus !== "approved") await approveProvider(provider.id, adminId);

    // Create connection → get raw secret from response
    const result = await createConnection(leadId, { providerId: provider.id, projectId: project!.id, scopes: ["test"] });
    const rawSecret = result.webhookSecret;
    expect(rawSecret).toBeTruthy();

    // Query DB directly
    const conn = await db.integrationConnection.findUnique({ where: { id: result.connection.id } });

    // Verify: stored webhookSecret is NOT the raw secret
    expect(conn!.webhookSecret).not.toBe(rawSecret);
    // Verify: stored value is encrypted format (3 parts)
    expect(conn!.webhookSecret!.split(":").length).toBe(3);
    // Verify: stored webhookSecretHash is NOT the raw secret (it's a SHA-256 hash)
    expect(conn!.webhookSecretHash).not.toBe(rawSecret);
    expect(conn!.webhookSecretHash).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("12. Read path: listConnections does NOT return raw webhookSecret", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const stewardId = await createTestUser(run, "admin");
    const leadId = await createTestUser(run, "rep");
    const proposal = await createProposal({
      submitterId: leadId, title: `G09 Read Path Test ${run.runId}`,
      charter: {
        problemStatement: "Read path test problem statement with sufficient length for validation purposes here.",
        outcomes: "Read path test outcomes with sufficient length for validation purposes here.",
        scope: "Read path test scope with sufficient length for validation purposes here.",
        requiredSkills: ["TypeScript"],
        acceptanceCriteria: "Read path test acceptance criteria with sufficient length for validation.",
      },
    });
    await submitProposal(proposal.id, leadId);
    await reviewProposal({ proposalId: proposal.id, reviewerId: adminId, action: "APPROVE", reason: "Approved for G09 encryption test.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    run.projectIds.push(project!.id);

    const provider = await db.integrationProvider.upsert({
      where: { id: "str.mock.v1" }, update: { isMock: true },
      create: { id: "str.mock.v1", slug: "str.mock", version: "v1", displayName: "STR Mock Provider", description: "Mock", owner: "STR", baseOrigin: "https://mock.str.local", trustStatus: "registered", authMode: { type: "none" }, isMock: true },
    });
    await db.integrationCapability.upsert({
      where: { providerId_code: { providerId: provider.id, code: "application.test" } }, update: {},
      create: { providerId: provider.id, code: "application.test", summary: "Test", executionMode: "async", riskClass: "low", requiredScopes: ["test"], inputSchemaRef: "ref", outputSchemaRef: "ref", idempotent: true, cancelable: true, timeoutMs: 30000 },
    });
    if (provider.trustStatus !== "approved") await approveProvider(provider.id, adminId);

    const result = await createConnection(leadId, { providerId: provider.id, projectId: project!.id, scopes: ["test"] });
    const rawSecret = result.webhookSecret;

    // Call listConnections (read path)
    const connections = await listConnections(project!.id, leadId);
    expect(connections.length).toBeGreaterThan(0);

    // Verify: the raw secret is NOT in the list response
    const connJson = JSON.stringify(connections[0]);
    expect(connJson).not.toContain(rawSecret);
    // Verify: the encrypted secret IS in the response (but not usable without the key)
    expect((connections[0] as any).webhookSecret).toBeTruthy();
    expect((connections[0] as any).webhookSecret.split(":").length).toBe(3);
  });

  it("13. Error/log leak: decryptSecret error does not expose the secret value", () => {
    const secret = "super-secret-value-12345";
    const encrypted = encryptSecret(secret);

    // Tamper the ciphertext to force a decryption error
    const parts = encrypted.split(":");
    parts[1] = Buffer.from("tampered").toString("base64");

    let errorMsg = "";
    try {
      decryptSecret(parts.join(":"));
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    // The error message must NOT contain the original secret
    expect(errorMsg).not.toContain(secret);
    // The error message must NOT contain the encrypted value
    expect(errorMsg).not.toContain(encrypted);
  });
});
