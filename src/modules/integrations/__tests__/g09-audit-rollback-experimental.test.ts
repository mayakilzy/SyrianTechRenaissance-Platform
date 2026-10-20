/**
 * STR G09 Priority 2 — Gap 3 Atomicity: Experimental Rollback Test
 * ------------------------------------------------------------------
 * Per ChatGPT review: the structural test (reading source code) is useful
 * but does NOT experimentally prove that a tx.auditEvent.create failure
 * rolls back the state change.
 *
 * This file provides the EXPERIMENTAL test that was missing.
 *
 * STRATEGY (FIX 4 — per ChatGPT point #4):
 *   We can't easily mock tx.auditEvent.create (the transaction client
 *   creates its own delegate, so instance patches don't propagate).
 *   Instead, we test the CONTRACT that approveProvider depends on:
 *   db.$transaction rolls back ALL writes if the callback throws.
 *
 *   We do this by running a $transaction that:
 *     1. Performs an updateMany on a real provider (state change).
 *     2. Then throws a simulated audit-write failure.
 *   We verify that the provider's state was ROLLED BACK (the updateMany
 *   did not persist).
 *
 *   This proves: IF approveProvider uses db.$transaction with the state
 *   change BEFORE the audit write, THEN a failure in the audit write
 *   rolls back the state change. The structural test (in g09-audit-atomic)
 *   confirms approveProvider actually does this ordering.
 *
 *   Together, the two tests prove the rollback behavior:
 *     - g09-audit-atomic Test 1 (structural): approveProvider's audit write
 *       is INSIDE the $transaction, AFTER the updateMany.
 *     - THIS test (experimental): db.$transaction rolls back on throw.
 *
 *   No production code is weakened for this test — we use the public
 *   db.$transaction API directly.
 */
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
  type TestRun,
} from "@/modules/organizations/__tests__/test-isolation";

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

describe("G09-P2 Gap 3 — Experimental Rollback Test", () => {
  // ─────────────────────────────────────────────────────────────────────
  // Test: db.$transaction rolls back ALL writes when the callback throws
  //
  // This is the experimental proof that was missing. We simulate exactly
  // what would happen if tx.auditEvent.create failed: the $transaction
  // callback throws AFTER the state change, and we verify the state
  // change was rolled back.
  // ─────────────────────────────────────────────────────────────────────
  it("db.$transaction rolls back state change when callback throws (simulated audit-write failure)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    // Create a unique provider in "registered" state.
    const providerId = `str.mock.rollback-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Rollback Test Provider",
        description: "Provider for experimental rollback test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // CRITICAL: this is the experimental simulation. We run a $transaction
    // that mirrors approveProvider's structure:
    //   1. updateMany (state change: registered → approved)
    //   2. throw (simulating tx.auditEvent.create failure)
    //
    // We do NOT call tx.auditEvent.create — we just throw to simulate
    // its failure. This proves the $transaction rolls back the updateMany.
    const SIMULATED_AUDIT_FAILURE = "SIMULATED_AUDIT_WRITE_FAILURE";
    await expect(
      db.$transaction(async (tx) => {
        // Step 1: state change (same as approveProvider's updateMany)
        const result = await tx.integrationProvider.updateMany({
          where: { id: providerId, trustStatus: "registered" },
          data: { trustStatus: "approved", approvedById: adminId, approvedAt: new Date() },
        });
        expect(result.count).toBe(1); // state change succeeded within the tx

        // Step 2: simulate the audit write failing.
        // In approveProvider, this is where tx.auditEvent.create runs.
        // We throw to simulate its failure.
        throw new Error(SIMULATED_AUDIT_FAILURE);
      }),
    ).rejects.toThrow(SIMULATED_AUDIT_FAILURE);

    // CRITICAL: the state change was ROLLED BACK.
    // The provider is still "registered" — the updateMany did NOT persist.
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("registered"); // NOT "approved"
    expect(provider?.approvedById).toBeNull();
    expect(provider?.approvedAt).toBeNull();

    // CRITICAL: no AuditEvent was committed (we never got to that step).
    const audits = await db.auditEvent.findMany({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audits.length).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test: db.$transaction commits ALL writes when the callback succeeds
  //
  // Positive control: when the callback completes without throwing,
  // BOTH the state change AND the audit write persist.
  // ─────────────────────────────────────────────────────────────────────
  it("db.$transaction commits both state change and audit when callback succeeds (positive control)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const providerId = `str.mock.commit-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Commit Test Provider",
        description: "Provider for commit positive control",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // Run a $transaction that mirrors approveProvider's structure, but
    // completes successfully (no throw).
    await db.$transaction(async (tx) => {
      const result = await tx.integrationProvider.updateMany({
        where: { id: providerId, trustStatus: "registered" },
        data: { trustStatus: "approved", approvedById: adminId, approvedAt: new Date() },
      });
      expect(result.count).toBe(1);

      // Simulate the audit write (in approveProvider, this is
      // tx.auditEvent.create — here we use tx.auditEvent.create directly
      // since we just need to prove both writes commit together).
      await tx.auditEvent.create({
        data: {
          actorId: adminId,
          action: "provider.approve",
          targetType: "IntegrationProvider",
          targetId: providerId,
          outcome: "success",
        },
      });
    });

    // Both writes committed.
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("approved");

    const audits = await db.auditEvent.findMany({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audits.length).toBe(1);
    expect(audits[0]?.outcome).toBe("success");
  });
});
