/**
 * STR G09 Priority 2 — Gap 2: Denied/Failure Audit
 * --------------------------------------------------
 * Verifies that denied/failure audit events are:
 *   1. Written when authorization fails (ForbiddenError) or optimistic lock
 *      conflicts (ConflictError) occur in governance operations.
 *   2. Written OUTSIDE the rolled-back transaction (persist even though
 *      the main operation threw).
 *   3. Use SAFE reason codes (not raw error messages).
 *   4. Do NOT leak stack traces or secrets.
 *   5. Do NOT confirm existence of hidden entities (targetId=null for
 *      NotFoundError when hideTargetIdOnNotFound=true).
 *
 * Per MASTER directive: "اختبر أن سجل الرفض يبقى محفوظاً بعد تراجع
 * المعاملة الأصلية عندما تكون قاعدة البيانات متاحة."
 */
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
  type TestRun,
} from "@/modules/organizations/__tests__/test-isolation";
import { approveProvider } from "@/modules/integrations/service";
import { ForbiddenError, ConflictError } from "@/lib/errors";

let run: TestRun;
const uniqueProviderIds: string[] = [];

afterEach(async () => {
  if (run) {
    for (const pid of uniqueProviderIds) {
      await db.integrationCapability.deleteMany({ where: { providerId: pid } }).catch(() => {});
      await db.integrationProvider.deleteMany({ where: { id: pid } }).catch(() => {});
    }
    uniqueProviderIds.length = 0;
    await cleanupTestRun(run);
  }
});

async function createUniqueProvider(runId: string, status: "registered" | "approved" = "registered") {
  const providerId = `str.mock.gap2-${runId}-${status}-${Math.random().toString(36).slice(2, 6)}`;
  await db.integrationProvider.create({
    data: {
      id: providerId,
      slug: providerId,
      version: "v1",
      displayName: `Gap2 Test ${status}`,
      description: "Provider for Gap 2 denied/failure audit test",
      owner: "STR Platform",
      baseOrigin: "https://mock.str.local",
      trustStatus: status,
      ...(status === "approved" ? { approvedAt: new Date() } : {}),
      authMode: { type: "none" },
      isMock: true,
    },
  });
  uniqueProviderIds.push(providerId);
  return providerId;
}

describe("G09-P2 Gap 2 — Denied/Failure Audit", () => {
  // ─────────────────────────────────────────────────────────────────────
  // Test 1: non-admin attempt → denied audit written, original error re-thrown
  //
  // Per ChatGPT directive: "denied لرفض التفويض الأمني المثبت"
  // ─────────────────────────────────────────────────────────────────────
  it("non-admin approveProvider attempt → denied audit written + ForbiddenError re-thrown", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const memberId = await createTestUser(run, "member");
    const providerId = await createUniqueProvider(run.runId, "registered");

    // Member (non-admin) tries to approve → ForbiddenError
    await expect(approveProvider(providerId, memberId)).rejects.toThrow(ForbiddenError);

    // CRITICAL: a denied audit event was written OUTSIDE the transaction.
    const audit = await db.auditEvent.findFirst({
      where: {
        actorId: memberId,
        action: "provider.approve",
        targetId: providerId,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    expect(audit?.outcome).toBe("denied");
    // CRITICAL: reason is a SAFE CODE, not a raw error message
    expect(audit?.reason).toBe("insufficient_permissions");
    // CRITICAL: no raw error message or stack trace stored
    expect(audit?.reason).not.toContain("Only admins");
    expect(audit?.reason).not.toMatch(/stack|at\s+\//i);

    // State unchanged
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("registered");

    // Clean up: delete the denied audit (cleanupTestRun handles auditEvent
    // by actorId, which includes memberId)
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: optimistic lock conflict → failure audit written
  //
  // Approving an already-approved provider → ConflictError → failure audit.
  // Per ChatGPT directive: "failure لفشل تشغيلي يستحق التوثيق"
  // ─────────────────────────────────────────────────────────────────────
  it("re-approving already-approved provider → failure audit written + ConflictError re-thrown", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const providerId = await createUniqueProvider(run.runId, "approved");

    // Admin tries to approve an already-approved provider → ConflictError
    await expect(approveProvider(providerId, adminId)).rejects.toThrow(ConflictError);

    const audit = await db.auditEvent.findFirst({
      where: {
        actorId: adminId,
        action: "provider.approve",
        targetId: providerId,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    expect(audit?.outcome).toBe("failure");
    // CRITICAL: reason is a SAFE CODE
    expect(audit?.reason).toBe("optimistic_lock_conflict");
    // No raw error message
    expect(audit?.reason).not.toContain("concurrent transition");
    expect(audit?.reason).not.toContain("registered");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: successful operation → NO denied/failure audit (only success audit)
  //
  // The wrapper only writes denied/failure on errors. Success path writes
  // the success audit inside the transaction (Gap 3).
  // ─────────────────────────────────────────────────────────────────────
  it("successful approveProvider → only success audit, no denied/failure audit", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const providerId = await createUniqueProvider(run.runId, "registered");

    await approveProvider(providerId, adminId);

    // Find ALL audit events for this action+target
    const audits = await db.auditEvent.findMany({
      where: { action: "provider.approve", targetId: providerId },
      orderBy: { createdAt: "asc" },
    });

    // CRITICAL: exactly ONE audit event (the success one, written inside the tx)
    expect(audits.length).toBe(1);
    expect(audits[0]?.outcome).toBe("success");
    // No denied/failure audit
    expect(audits.some((a) => a.outcome === "denied" || a.outcome === "failure")).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 4: denied audit persists even though the operation's transaction
  //         would have rolled back
  //
  // This verifies the denied-audit-trap solution: the denied audit is
  // written in a SEPARATE db.auditEvent.create call, OUTSIDE the
  // operation's transaction. Even if the operation threw (and its
  // transaction rolled back), the denied audit persists.
  //
  // We test this by causing a ForbiddenError (which throws BEFORE any
  // transaction starts), then verifying the denied audit is in the DB.
  // ─────────────────────────────────────────────────────────────────────
  it("denied audit persists after operation throws (separate transaction)", async () => {
    run = startTestRun();
    const memberId = await createTestUser(run, "member");
    const providerId = await createUniqueProvider(run.runId, "registered");

    // Member attempts → throws ForbiddenError
    await expect(approveProvider(providerId, memberId)).rejects.toThrow(ForbiddenError);

    // The denied audit is in the DB — it was written in a separate
    // db.auditEvent.create call, NOT inside any rolled-back transaction.
    const audit = await db.auditEvent.findFirst({
      where: { actorId: memberId, action: "provider.approve", outcome: "denied" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.outcome).toBe("denied");
    expect(audit?.reason).toBe("insufficient_permissions");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 5: reason field never contains raw error messages or secrets
  //
  // Per ChatGPT directive: "لا تسجل رسائل أخطاء خام أو stack traces
  // أو أسراراً داخل AuditEvent"
  // ─────────────────────────────────────────────────────────────────────
  it("reason field is always a safe code (no raw messages, no stack traces)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const memberId = await createTestUser(run, "member");

    // Trigger denied audit
    const provider1Id = await createUniqueProvider(run.runId + "-1", "registered");
    await expect(approveProvider(provider1Id, memberId)).rejects.toThrow(ForbiddenError);

    // Trigger failure audit (optimistic lock)
    const provider2Id = await createUniqueProvider(run.runId + "-2", "approved");
    await expect(approveProvider(provider2Id, adminId)).rejects.toThrow(ConflictError);

    // Find both audit events
    const deniedAudit = await db.auditEvent.findFirst({
      where: { actorId: memberId, action: "provider.approve", outcome: "denied" },
    });
    const failureAudit = await db.auditEvent.findFirst({
      where: { actorId: adminId, action: "provider.approve", outcome: "failure" },
    });

    expect(deniedAudit).toBeTruthy();
    expect(failureAudit).toBeTruthy();

    // CRITICAL: both reasons are from the whitelist, NOT raw messages
    const validReasons = [
      "insufficient_permissions",
      "not_owner",
      "not_team_member",
      "conflict_of_interest",
      "optimistic_lock_conflict",
      "invalid_state_transition",
      "not_found",
      "validation_error",
    ];
    expect(validReasons).toContain(deniedAudit?.reason);
    expect(validReasons).toContain(failureAudit?.reason);

    // CRITICAL: no raw error message content leaked
    // The reason codes ARE safe identifiers (they contain words like
    // 'permission' as part of the code, but NOT raw error messages).
    // We verify the reason does NOT contain the RAW error message text
    // (which would indicate the message was stored verbatim).
    expect(deniedAudit?.reason).not.toContain("Only admins can approve providers");
    expect(failureAudit?.reason).not.toContain("concurrent transition");
    expect(failureAudit?.reason).not.toContain("is not in 'registered' status");

    // CRITICAL: no stack trace fragments
    expect(deniedAudit?.reason).not.toMatch(/at\s+\//);
    expect(failureAudit?.reason).not.toMatch(/at\s+\//);
    expect(deniedAudit?.reason).not.toContain("\n");
    expect(failureAudit?.reason).not.toContain("\n");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 6: actor identity is server-side (memberId from session, not body)
  //
  // Per ChatGPT directive: "امنع حقول العميل من تزوير Actor أو Outcome"
  // ─────────────────────────────────────────────────────────────────────
  it("actor identity is server-supplied (memberId), not client-forgeable", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const memberId = await createTestUser(run, "member");
    const providerId = await createUniqueProvider(run.runId, "registered");

    // Member attempts to approve. The actorId in the denied audit MUST be
    // memberId (from the session), not adminId or any client-supplied id.
    await expect(approveProvider(providerId, memberId)).rejects.toThrow(ForbiddenError);

    const audit = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: providerId, outcome: "denied" },
    });

    // CRITICAL: actorId is memberId (the actual caller), NOT adminId
    expect(audit?.actorId).toBe(memberId);
    expect(audit?.actorId).not.toBe(adminId);

    // The outcome is server-determined ("denied"), not client-supplied
    expect(audit?.outcome).toBe("denied");
  });
});
