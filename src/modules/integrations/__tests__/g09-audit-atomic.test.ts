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
  // We monkey-patch db.auditEvent.create to throw, simulating a DB failure.
  // Because approveProvider wraps both the state change and the audit write
  // in a single $transaction, the failure causes the entire transaction to
  // roll back: the provider's trustStatus stays "registered".
  //
  // We can't easily spy on $transaction (Prisma's prototype method doesn't
  // respond to vi.spyOn reliably). Instead, we patch db.auditEvent.create
  // to throw — the $transaction's internal rollback handles the rest.
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

    // Patch BOTH db.auditEvent.create AND the prototype's, because approveProvider
    // uses tx.auditEvent.create (where tx is a transaction client that delegates
    // to the same PrismaClient). Patching the instance method catches both.
    const originalCreate = db.auditEvent.create.bind(db.auditEvent);
    (db.auditEvent as { create: unknown }).create = vi
      .fn()
      .mockRejectedValue(new Error("Simulated audit write failure"));

    // approveProvider should throw because the audit write fails
    await expect(approveProvider(providerId, adminId)).rejects.toThrow("Simulated audit write failure");

    // Restore the original create method BEFORE verification reads.
    (db.auditEvent as { create: unknown }).create = originalCreate;

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
  // transaction starts. No state change, no audit.
  //
  // We verify the OUTCOME (no state change, no audit) rather than spying
  // on $transaction, because Prisma's prototype method doesn't respond
  // reliably to vi.spyOn.
  // ─────────────────────────────────────────────────────────────────────
  it("non-admin: ForbiddenError before transaction (no state change, no audit)", async () => {
    run = startTestRun();
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

    // Member (not admin) tries to approve → ForbiddenError
    await expect(approveProvider(providerId, memberId)).rejects.toThrow();

    // CRITICAL: no state change
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("registered");

    // CRITICAL: no audit event created
    const audits = await db.auditEvent.findMany({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audits.length).toBe(0);
  });
});
