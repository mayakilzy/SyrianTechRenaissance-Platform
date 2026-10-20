/**
 * STR G09 Priority 2 — Gap 3: Atomic Success Audit
 * --------------------------------------------------
 * Verifies that state change + audit write are atomic: if the audit
 * write fails, the state change rolls back (no state change without
 * audit trail).
 *
 * Per MASTER directive: test that "فشل كتابة AuditEvent وتراجع تغيير
 * الحالة" (audit write failure rolls back state change).
 *
 * Strategy: mock `tx.auditEvent.create` to throw, then verify the
 * state change was NOT committed. We use Prisma's transaction
 * rollback behavior: throwing inside db.$transaction(async (tx) => ...)
 * rolls back the entire transaction.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
  type TestRun,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import { approveProvider } from "@/modules/integrations/service";
import { ConflictError } from "@/lib/errors";
import { Prisma } from "@prisma/client";

let run: TestRun;
const uniqueProviderIds: string[] = [];

afterEach(async () => {
  if (run) {
    for (const pid of uniqueProviderIds) {
      await db.integrationCapability.deleteMany({ where: { providerId: pid } }).catch(() => {});
      await db.integrationProvider.deleteMany({ where: { id: pid } }).catch(() => {});
    }
    uniqueProviderIds.length = 0;
    vi.restoreAllMocks();
    await cleanupTestRun(run);
  }
});

describe("G09-P2 Gap 3 — Atomic Success Audit", () => {
  // ─────────────────────────────────────────────────────────────────────
  // Test 1: audit write failure rolls back the state change
  //
  // We monkey-patch db.$transaction to inject a failure into the audit
  // write. When the audit create throws, the entire transaction rolls
  // back: the provider's trustStatus stays "registered".
  // ─────────────────────────────────────────────────────────────────────
  it("audit write failure rolls back the state change (no approval without audit)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const providerId = `str.mock.atomic-fail-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Atomic Fail Test Provider",
        description: "Provider for audit-failure rollback test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // Spy on db.$transaction. When the inner function calls tx.auditEvent.create,
    // throw an error to simulate a DB failure during audit write.
    const originalTransaction = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementation(async (fnOrArray: unknown) => {
      // Only intercept interactive transactions (function argument)
      if (typeof fnOrArray !== "function") {
        return originalTransaction(fnOrArray as never);
      }
      // Call the original transaction but with a patched tx that throws on auditEvent.create
      return originalTransaction(async (tx) => {
        // Patch tx.auditEvent.create to throw
        const originalAuditCreate = tx.auditEvent.create.bind(tx.auditEvent);
        tx.auditEvent.create = vi.fn().mockRejectedValue(new Error("Simulated audit write failure")) as never;
        // Keep other tx methods intact
        try {
          return await (fnOrArray as (tx: never) => Promise<unknown>)(tx as never);
        } finally {
          // Restore for cleanup (though tx is discarded after transaction)
          tx.auditEvent.create = originalAuditCreate as never;
        }
      });
    });

    // approveProvider should throw because the audit write fails
    await expect(approveProvider(providerId, adminId)).rejects.toThrow("Simulated audit write failure");

    // CRITICAL: the provider state change was ROLLED BACK
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("registered"); // NOT "approved"
    expect(provider?.approvedById).toBeNull();
    expect(provider?.approvedAt).toBeNull();

    // CRITICAL: no AuditEvent was committed
    const audit = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audit).toBeNull();

    spy.mockRestore();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: optimistic lock conflict — state change fails, no audit
  //
  // If the provider is already "approved" (concurrent transition), the
  // updateMany returns count=0, the transaction throws ConflictError,
  // and NO audit event is created.
  // ─────────────────────────────────────────────────────────────────────
  it("optimistic lock conflict: no state change, no audit event", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    // Create a provider that's ALREADY approved
    const providerId = `str.mock.already-approved-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Already Approved Provider",
        description: "Provider for optimistic lock test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "approved", // already approved
        approvedById: adminId,
        approvedAt: new Date(),
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // approveProvider should throw ConflictError
    await expect(approveProvider(providerId, adminId)).rejects.toThrow(ConflictError);

    // CRITICAL: no new AuditEvent was created (the transaction rolled back)
    const audits = await db.auditEvent.findMany({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audits.length).toBe(0);

    // State is unchanged
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("approved");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: successful operation — state change AND audit in one transaction
  //
  // Normal path: approveProvider succeeds, both the state change and
  // the audit event are committed atomically.
  // ─────────────────────────────────────────────────────────────────────
  it("successful operation: state change + audit committed atomically", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const providerId = `str.mock.atomic-success-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Atomic Success Provider",
        description: "Provider for atomic success test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    await approveProvider(providerId, adminId);

    // Both state change AND audit event committed
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("approved");
    expect(provider?.approvedById).toBe(adminId);

    const audit = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audit).toBeTruthy();
    expect(audit?.outcome).toBe("success");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 4: concurrent approveProvider calls — exactly one wins
  //
  // Two concurrent calls to approveProvider on the same "registered"
  // provider: the optimistic lock ensures exactly one succeeds. The
  // winner's transaction commits (state + audit); the loser's
  // transaction rolls back (no state change, no audit).
  // ─────────────────────────────────────────────────────────────────────
  it("concurrent approveProvider: exactly one wins, one audit event", async () => {
    run = startTestRun();
    const admin1Id = await createTestUser(run, "admin");
    const admin2Id = await createTestUser(run, "admin");

    const providerId = `str.mock.concurrent-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Concurrent Test Provider",
        description: "Provider for concurrent atomic test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    const results = await Promise.allSettled([
      approveProvider(providerId, admin1Id),
      approveProvider(providerId, admin2Id),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(1);

    // CRITICAL: exactly ONE audit event (the winner's)
    const audits = await db.auditEvent.findMany({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audits.length).toBe(1);

    // State is "approved" with the winner's adminId
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("approved");
    expect([admin1Id, admin2Id]).toContain(provider?.approvedById);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 5: authorization still enforced (isAdmin check outside transaction)
  //
  // A non-admin calling approveProvider gets ForbiddenError BEFORE the
  // transaction starts. No state change, no audit, no transaction overhead.
  // ─────────────────────────────────────────────────────────────────────
  it("non-admin: ForbiddenError before transaction (no state change, no audit)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const memberId = await createTestUser(run, "member");

    const providerId = `str.mock.nonadmin-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Non-Admin Test Provider",
        description: "Provider for non-admin atomic test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // Spy on $transaction to verify it's NOT called for non-admin
    const spy = vi.spyOn(db, "$transaction");

    await expect(approveProvider(providerId, memberId)).rejects.toThrow();

    // CRITICAL: $transaction was NOT called (authorization failed first)
    expect(spy).not.toHaveBeenCalled();

    // No state change, no audit
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("registered");

    const audits = await db.auditEvent.findMany({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audits.length).toBe(0);

    spy.mockRestore();
  });
});
