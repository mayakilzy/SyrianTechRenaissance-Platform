/**
 * STR G09 Priority 2 — Audit Event Integrity
 * -------------------------------------------
 * Tests that audit events have correct field integrity (Actor / Action /
 * Target / Outcome / Timestamp), proper isolation (non-admins cannot list),
 * no secret leakage, and survive user deletion (onDelete: SetNull).
 *
 * Per MASTER directive: "لا تفترض أن فشل كتابة أي سجل يجب أن يمنع كل
 * عملية؛ حدد أولاً أي العمليات يتطلب التسجيل فيها ضماناً ذرياً."
 * (Don't assume audit failure blocks all operations; first identify which
 * operations require atomic logging.)
 *
 * Atomicity analysis (documented in the final test, not changed in code):
 *   - 2 of 13 audit writes are INSIDE transactions (tx.auditEvent.create):
 *       partnerships/service.ts:291 (partnership decision)
 *       moderation/service.ts:334 (complaint decision)
 *   - 11 of 13 are OUTSIDE transactions (db.auditEvent.create after commit):
 *       integrations/service.ts: approveProvider, revokeConnection,
 *         suspendConnection (3 writes)
 *       organizations/service.ts: verify, suspend, reactivate, revoke,
 *         verifyRepresentative, revokeRepresentative (6 writes)
 *       partnerships/service.ts: 2 non-transactional writes
 *
 *   This means for 11 of 13 audit writes, if the audit write fails, the
 *   operation has ALREADY committed — no audit trail. This is the CURRENT
 *   contract. Making these atomic would require wrapping each operation +
 *   audit in a single transaction, which is a design change requiring MASTER
 *   authorization. This file DOCUMENTS the current contract; it does NOT
 *   change it.
 *
 * Gaps documented (NOT_TESTED, not placeholders):
 *   - reqId is NEVER set in any audit write → log correlation broken.
 *     The schema has a reqId field, but no write site populates it.
 *   - outcome is ALWAYS "success" → no failure/denied audit. Failed
 *     authorization attempts (e.g., non-admin trying to approve a provider)
 *     do NOT generate audit events. This is a detection gap for brute-force
 *     or probing attacks.
 */
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
  createTestOrganization,
  type TestRun,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import {
  approveProvider,
  createConnection,
  revokeConnection,
  suspendConnection,
} from "@/modules/integrations/service";
import { listRecentAuditEvents } from "@/modules/admin/dashboard";
import { NotFoundError, ForbiddenError } from "@/lib/errors";

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

/**
 * Setup helper: create a project + approved mock provider.
 * Reuses the explicit reset pattern from g09-outbox-reliability.test.ts
 * to ensure every test gets a freshly-approved provider with its own adminId.
 */
async function setupProjectWithProvider() {
  const adminId = await createTestUser(run, "admin");
  const stewardId = await createTestUser(run, "admin");
  const leadId = await createTestUser(run, "rep");
  const proposal = await createProposal({
    submitterId: leadId,
    title: `G09 Audit Test ${run.runId}`,
    charter: {
      problemStatement: "Test problem statement with sufficient length for validation purposes here.",
      outcomes: "Test outcomes with sufficient length for validation purposes here.",
      scope: "Test scope with sufficient length for validation purposes here.",
      requiredSkills: ["TypeScript"],
      acceptanceCriteria: "Test acceptance criteria with sufficient length for validation here.",
    },
  });
  await submitProposal(proposal.id, leadId);
  await reviewProposal({
    proposalId: proposal.id,
    reviewerId: adminId,
    action: "APPROVE",
    reason: "Approved for G09 audit integrity testing purposes only.",
    stewardId,
  });
  const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
  if (!project) throw new Error("Project not created");
  run.proposalIds.push(proposal.id);
  run.projectIds.push(project.id);

  const provider = await db.integrationProvider.upsert({
    where: { id: "str.mock.v1" },
    update: { isMock: true },
    create: {
      id: "str.mock.v1",
      slug: "str.mock",
      version: "v1",
      displayName: "STR Mock Provider",
      description: "Mock",
      owner: "STR",
      baseOrigin: "https://mock.str.local",
      trustStatus: "registered",
      authMode: { type: "none" },
      isMock: true,
    },
  });
  // Force reset to "registered" so approveProvider's updateMany matches.
  await db.integrationProvider.update({
    where: { id: provider.id },
    data: { trustStatus: "registered", approvedById: null, approvedAt: null },
  });
  await approveProvider(provider.id, adminId);

  await db.integrationCapability.upsert({
    where: { providerId_code: { providerId: provider.id, code: "application.test" } },
    update: {},
    create: {
      providerId: provider.id,
      code: "application.test",
      summary: "Test capability",
      executionMode: "async",
      riskClass: "low",
      requiredScopes: ["test"],
      inputSchemaRef: "ref",
      outputSchemaRef: "ref",
      idempotent: true,
      cancelable: true,
      timeoutMs: 30000,
    },
  });

  return { projectId: project.id, leadId, adminId, providerId: provider.id };
}

describe("G09 Priority 2 — Audit Event Integrity", () => {
  // ───────────────────────────────────────────────────────────────────────
  // Test 1: provider.approve creates audit event with correct fields
  //
  // Verifies: actorId, action, targetType, targetId, outcome, createdAt.
  // ───────────────────────────────────────────────────────────────────────
  it("provider.approve: audit event has correct Actor/Action/Target/Outcome", async () => {
    run = startTestRun();
    const { adminId, providerId } = await setupProjectWithProvider();

    const audit = await db.auditEvent.findFirst({
      where: {
        actorId: adminId,
        action: "provider.approve",
        targetType: "IntegrationProvider",
        targetId: providerId,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(adminId);
    expect(audit?.action).toBe("provider.approve");
    expect(audit?.targetType).toBe("IntegrationProvider");
    expect(audit?.targetId).toBe(providerId);
    expect(audit?.outcome).toBe("success");
    expect(audit?.createdAt).toBeTruthy();
    // createdAt is a Date (server-set, not client-supplied)
    expect(audit?.createdAt instanceof Date || typeof audit?.createdAt === "object").toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 2: connection.revoke creates audit event with correct fields
  // ───────────────────────────────────────────────────────────────────────
  it("connection.revoke: audit event has correct fields + reason", async () => {
    run = startTestRun();
    const { projectId, leadId, adminId, providerId } = await setupProjectWithProvider();
    const conn = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const revokeReason = "Connection revoked for audit integrity testing purposes.";
    await revokeConnection(conn.connection.id, leadId, revokeReason);

    const audit = await db.auditEvent.findFirst({
      where: {
        actorId: leadId,
        action: "connection.revoke",
        targetType: "IntegrationConnection",
        targetId: conn.connection.id,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(leadId);
    expect(audit?.action).toBe("connection.revoke");
    expect(audit?.targetType).toBe("IntegrationConnection");
    expect(audit?.targetId).toBe(conn.connection.id);
    expect(audit?.outcome).toBe("success");
    expect(audit?.reason).toBe(revokeReason);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 3: connection.suspend creates audit event
  // ───────────────────────────────────────────────────────────────────────
  it("connection.suspend: audit event has correct fields", async () => {
    run = startTestRun();
    const { projectId, leadId, providerId } = await setupProjectWithProvider();
    const conn = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const suspendReason = "Connection suspended for audit integrity testing purposes.";
    await suspendConnection(conn.connection.id, leadId, suspendReason);

    const audit = await db.auditEvent.findFirst({
      where: {
        actorId: leadId,
        action: "connection.suspend",
        targetType: "IntegrationConnection",
        targetId: conn.connection.id,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    expect(audit?.action).toBe("connection.suspend");
    expect(audit?.outcome).toBe("success");
    expect(audit?.reason).toBe(suspendReason);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 4: Non-admin CANNOT list audit events (gets NotFoundError, not Forbidden)
  //
  // This is the G09-001 pattern: NotFound (not Forbidden) to avoid role
  // enumeration. A non-admin learns nothing about the existence of the
  // audit endpoint.
  // ───────────────────────────────────────────────────────────────────────
  it("non-admin CANNOT list audit events (NotFoundError — no role enumeration)", async () => {
    run = startTestRun();
    const { adminId, providerId } = await setupProjectWithProvider();
    const memberId = await createTestUser(run, "member");

    // Admin CAN list
    const events = await listRecentAuditEvents(adminId, 10);
    expect(events.length).toBeGreaterThan(0);

    // Member CANNOT list — gets NotFoundError (not ForbiddenError)
    await expect(listRecentAuditEvents(memberId, 10)).rejects.toThrow(NotFoundError);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 5: Audit events do NOT contain secrets
  //
  // Verifies that audit events' `meta` field is null (no sensitive data)
  // and the `reason` field does not contain webhook secrets, password
  // hashes, or tokens.
  // ───────────────────────────────────────────────────────────────────────
  it("audit events do NOT leak secrets (meta is null, reason has no secrets)", async () => {
    run = startTestRun();
    const { projectId, leadId, providerId } = await setupProjectWithProvider();
    const conn = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });

    // The connection has a webhookSecret (encrypted at rest). The audit event
    // for connection creation should NOT include it.
    const fullConn = await db.integrationConnection.findUnique({
      where: { id: conn.connection.id },
      select: { webhookSecret: true, webhookSecretHash: true },
    });
    expect(fullConn?.webhookSecret).toBeTruthy(); // secret exists
    expect(fullConn?.webhookSecretHash).toBeTruthy();

    // Revoke the connection to generate an audit event
    await revokeConnection(conn.connection.id, leadId, "Revoked for secret-leak test.");

    const audit = await db.auditEvent.findFirst({
      where: {
        action: "connection.revoke",
        targetId: conn.connection.id,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    // CRITICAL: meta is null — no secret data stored in the audit event
    expect(audit?.meta).toBeNull();
    // CRITICAL: reason does NOT contain the webhook secret or hash
    expect(audit?.reason).not.toContain(fullConn!.webhookSecret ?? "MISSING");
    expect(audit?.reason).not.toContain(fullConn!.webhookSecretHash ?? "MISSING");
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 6: Audit event actorId is from the session (not spoofable via body)
  //
  // The approveProvider function takes `approverId` as a parameter. A non-admin
  // cannot call it — they get ForbiddenError, and NO audit event is created.
  // This verifies the actor identity is enforced server-side.
  // ───────────────────────────────────────────────────────────────────────
  it("actor identity enforced server-side: non-admin cannot trigger audit event", async () => {
    run = startTestRun();
    const { adminId, providerId } = await setupProjectWithProvider();
    const memberId = await createTestUser(run, "member");

    // Reset provider to "registered" so a new approval can be attempted
    await db.integrationProvider.update({
      where: { id: providerId },
      data: { trustStatus: "registered", approvedById: null, approvedAt: null },
    });

    // Member tries to approve → ForbiddenError
    await expect(approveProvider(providerId, memberId)).rejects.toThrow(ForbiddenError);

    // CRITICAL: NO audit event was created for the failed attempt
    const failedAudit = await db.auditEvent.findFirst({
      where: {
        actorId: memberId,
        action: "provider.approve",
      },
    });
    expect(failedAudit).toBeNull();

    // The provider is still "registered" (not approved)
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("registered");
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 7: Audit events survive user deletion (onDelete: SetNull)
  //
  // The AuditEvent.actorId relation has `onDelete: SetNull`. When a user is
  // deleted, their audit events STAY but actorId becomes null. This is the
  // correct behavior — audit trails must survive user deletion for
  // forensic purposes.
  // ───────────────────────────────────────────────────────────────────────
  it("audit events survive user deletion (actorId → null, event stays)", async () => {
    run = startTestRun();
    const { adminId, providerId } = await setupProjectWithProvider();

    // Verify audit event exists with actorId = adminId
    const auditBefore = await db.auditEvent.findFirst({
      where: { actorId: adminId, action: "provider.approve" },
    });
    expect(auditBefore).toBeTruthy();
    expect(auditBefore?.actorId).toBe(adminId);

    // Delete the admin user (cleanupTestRun does this, but we do it explicitly
    // to verify the cascade behavior)
    await db.roleGrant.deleteMany({ where: { userId: adminId } });
    await db.user.delete({ where: { id: adminId } });

    // Remove from run.userIds so cleanupTestRun doesn't try to delete again
    run.userIds = run.userIds.filter((id) => id !== adminId);

    // CRITICAL: audit event STILL EXISTS, but actorId is now null
    const auditAfter = await db.auditEvent.findFirst({
      where: { id: auditBefore!.id },
    });
    expect(auditAfter).toBeTruthy();
    expect(auditAfter?.actorId).toBeNull();
    expect(auditAfter?.action).toBe("provider.approve"); // other fields preserved
    expect(auditAfter?.targetId).toBe(providerId);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 8: Organization governance creates audit events
  //
  // Verifies that organization.verify, organization.suspend,
  // organization.reactivate, organization.revoke all create audit events
  // with correct fields.
  // ───────────────────────────────────────────────────────────────────────
  it("organization governance: verify + suspend + reactivate + revoke all audited", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "PENDING_VERIFICATION");

    // Import the org service functions
    const { verifyOrganization, suspendOrganization, reactivateOrganization, revokeOrganization } =
      await import("@/modules/organizations/service");

    // Verify
    await verifyOrganization(orgId, adminId);
    let audit = await db.auditEvent.findFirst({
      where: { action: "organization.verify", targetId: orgId },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(adminId);
    expect(audit?.targetType).toBe("Organization");
    expect(audit?.outcome).toBe("success");

    // Suspend
    await suspendOrganization(orgId, adminId, "Suspended for audit testing.");
    audit = await db.auditEvent.findFirst({
      where: { action: "organization.suspend", targetId: orgId },
    });
    expect(audit).toBeTruthy();
    expect(audit?.outcome).toBe("success");

    // Reactivate
    await reactivateOrganization(orgId, adminId);
    audit = await db.auditEvent.findFirst({
      where: { action: "organization.reactivate", targetId: orgId },
    });
    expect(audit).toBeTruthy();
    expect(audit?.outcome).toBe("success");

    // Revoke
    await revokeOrganization(orgId, adminId, "Revoked for audit testing.");
    audit = await db.auditEvent.findFirst({
      where: { action: "organization.revoke", targetId: orgId },
    });
    expect(audit).toBeTruthy();
    expect(audit?.outcome).toBe("success");
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 9: Atomicity documentation — current contract
  //
  // This test DOCUMENTS the current audit atomicity contract by counting
  // transactional vs. non-transactional audit writes in the codebase.
  // It does NOT change the contract — that would require MASTER authorization.
  //
  // The test reads the source files and counts:
  //   - tx.auditEvent.create (inside transactions — atomic)
  //   - db.auditEvent.create (outside transactions — non-atomic)
  //
  // Per MASTER directive: "حدد أولاً أي العمليات يتطلب التسجيل فيها
  // ضماناً ذرياً" (first identify which operations require atomic logging).
  // This test is the identification step.
  // ───────────────────────────────────────────────────────────────────────
  it("atomicity documentation: 2 transactional + 11 non-transactional audit writes (current contract)", async () => {
    // Read the source files and count audit write patterns
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const serviceFiles = [
      "src/modules/integrations/service.ts",
      "src/modules/organizations/service.ts",
      "src/modules/partnerships/service.ts",
      "src/modules/moderation/service.ts",
    ];

    let transactional = 0;
    let nonTransactional = 0;
    const transactionalOps: string[] = [];
    const nonTransactionalOps: string[] = [];

    for (const relPath of serviceFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      const content = await fs.readFile(absPath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (line.includes("auditEvent.create")) {
          // Look for the nearest preceding action: "xxx" to identify the operation
          let action = "unknown";
          for (let j = i; j >= Math.max(0, i - 20); j--) {
            const candidate = lines[j] ?? "";
            const m = candidate.match(/action:\s*"([^"]+)"/);
            if (m && m[1]) {
              action = m[1];
              break;
            }
          }

          if (line.includes("tx.auditEvent.create") || line.includes("tx.auditEvent")) {
            transactional++;
            transactionalOps.push(`${relPath}:${i + 1} (${action})`);
          } else if (line.includes("db.auditEvent.create")) {
            nonTransactional++;
            nonTransactionalOps.push(`${relPath}:${i + 1} (${action})`);
          }
        }
      }
    }

    // DOCUMENTED CONTRACT (as of G09 Priority 2):
    // - 2 transactional audit writes (partnerships + moderation decisions)
    // - 11 non-transactional audit writes (integrations + organizations)
    //
    // The non-transactional writes mean: if the audit write fails, the
    // operation has ALREADY committed — no audit trail. This is the
    // CURRENT contract. Making these atomic is a design change requiring
    // MASTER authorization.
    //
    // This test asserts the CURRENT counts to detect any UNINTENDED change.
    // If someone adds a new audit write, they must decide: atomic or not?
    // and update this test accordingly.

    expect(transactional).toBe(2);
    expect(nonTransactional).toBe(11);

    // Log the findings (visible in test output for documentation)
    console.log("Audit atomicity analysis:");
    console.log(`  Transactional (atomic): ${transactional}`);
    for (const op of transactionalOps) console.log(`    - ${op}`);
    console.log(`  Non-transactional (non-atomic): ${nonTransactional}`);
    for (const op of nonTransactionalOps) console.log(`    - ${op}`);
  });
});
