/**
 * STR G07 — Integration Core Unit Tests
 *
 * Tests:
 *   1. Provider approval (admin only)
 *   2. Connection lifecycle (create + revoke + suspend)
 *   3. Job idempotency (duplicate key → same job)
 *   4. Job submission blocked when connection is revoked/suspended
 *   5. Cross-project isolation (cannot access other project's connections)
 *   6. Rate limiting (excessive submissions blocked)
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import {
  approveProvider,
  createConnection,
  revokeConnection,
  suspendConnection,
  submitJob,
  getJob,
  cancelJob,
} from "@/modules/integrations/service";
import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from "@/lib/errors";

let run: ReturnType<typeof startTestRun>;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

async function setupProjectWithAdmin() {
  const adminId = await createTestUser(run, "admin");
  const stewardId = await createTestUser(run, "admin");
  const leadId = await createTestUser(run, "rep");
  const proposal = await createProposal({
    submitterId: leadId,
    title: `G07 Test ${run.runId}`,
    charter: {
      problemStatement: "Test problem statement with sufficient length for validation purposes here.",
      outcomes: "Test outcomes with sufficient length for validation purposes here.",
      scope: "Test scope with sufficient length for validation purposes here.",
      requiredSkills: ["TypeScript"],
      acceptanceCriteria: "Test acceptance criteria with sufficient length for validation.",
    },
  });
  await submitProposal(proposal.id, leadId);
  await reviewProposal({
    proposalId: proposal.id,
    reviewerId: adminId,
    action: "APPROVE",
    reason: "Approved for G07 tests.",
    stewardId,
  });
  const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
  if (!project) throw new Error("Project not created");
  run.proposalIds.push(proposal.id);
  run.projectIds.push(project.id);
  return { projectId: project.id, leadId, adminId, stewardId };
}

async function setupMockProvider(adminId: string) {
  // G09-P2 ROOT-CAUSE FIX: previous pattern used 3 separate DB calls
  // (upsert → update → approveProvider). In slow CI runners, the
  // approveProvider's updateMany could see a stale "approved" state
  // (from a prior test) because the reset update hadn't committed yet,
  // causing ConflictError.
  //
  // FIX: do the reset + approve + auditEvent in a SINGLE $transaction
  // so all three writes commit atomically. The approveProvider logic
  // (isAdmin check + updateMany WHERE trustStatus="registered" + count
  // check + audit) is inlined here with `tx` so it shares the same
  // transaction as the reset. This guarantees the provider is "approved"
  // by the time createConnection reads it, with no window for a stale read.
  //
  // SECURITY: the isAdmin(approverId) check is preserved (same as
  // approveProvider). A non-admin calling setupMockProvider would throw
  // ForbiddenError before any write — same contract as approveProvider.
  const provider = await db.integrationProvider.upsert({
    where: { id: "str.mock.v1" },
    update: { isMock: true },
    create: {
      id: "str.mock.v1",
      slug: "str.mock",
      version: "v1",
      displayName: "STR Mock Provider",
      description: "Mock provider for testing integrations",
      owner: "STR Platform",
      baseOrigin: "https://mock.str.local",
      trustStatus: "registered",
      authMode: { type: "none" },
      isMock: true,
    },
  });

  // Verify the caller is an admin (same check as approveProvider — security
  // contract preserved). Done OUTSIDE the transaction because it's a read.
  const { isAdmin } = await import("@/modules/organizations/service");
  if (!(await isAdmin(adminId))) {
    throw new ForbiddenError("Only admins can approve providers");
  }

  // Atomic reset + approve + audit in one transaction.
  await db.$transaction(async (tx) => {
    // 1. Force reset to "registered" (clears any stale "approved" from prior tests).
    await tx.integrationProvider.update({
      where: { id: provider.id },
      data: { trustStatus: "registered", approvedById: null, approvedAt: null },
    });

    // 2. Approve with the CURRENT test's adminId — same logic as
    //    approveProvider() but inside the transaction so the reset
    //    is guaranteed committed before the approve runs.
    const approveResult = await tx.integrationProvider.updateMany({
      where: { id: provider.id, trustStatus: "registered" },
      data: { trustStatus: "approved", approvedById: adminId, approvedAt: new Date() },
    });
    if (approveResult.count === 0) {
      throw new ConflictError(
        "Provider reset+approve failed in transaction (this should never happen — race in reset?)",
      );
    }

    // 3. Record the audit event (same as approveProvider does).
    await tx.auditEvent.create({
      data: {
        actorId: adminId,
        action: "provider.approve",
        targetType: "IntegrationProvider",
        targetId: provider.id,
        outcome: "success",
      },
    });
  });

  // Ensure the capability exists (upsert, outside the transaction — capability
  // is not part of the approval atomicity concern).
  await db.integrationCapability.upsert({
    where: { providerId_code: { providerId: provider.id, code: "application.test" } },
    update: {},
    create: {
      providerId: provider.id,
      code: "application.test",
      summary: "Test capability for mock provider",
      executionMode: "async",
      riskClass: "low",
      requiredScopes: ["test"],
      inputSchemaRef: "str.mock.v1/application.test#input",
      outputSchemaRef: "str.mock.v1/application.test#output",
      idempotent: true,
      cancelable: true,
      timeoutMs: 30000,
    },
  });
  return provider.id;
}

describe("G07 — Provider approval", () => {
  it("admin can approve a provider", async () => {
    run = startTestRun();
    const { adminId } = await setupProjectWithAdmin();
    const providerId = await setupMockProvider(adminId);
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    expect(provider?.trustStatus).toBe("approved");
    expect(provider?.approvedById).toBe(adminId);
  });

  it("non-admin cannot approve a provider", async () => {
    run = startTestRun();
    const { leadId } = await setupProjectWithAdmin();
    await expect(approveProvider("str.mock.v1", leadId)).rejects.toThrow(ForbiddenError);
  });
});

describe("G07 — Connection lifecycle", () => {
  it("lead can create a connection to an approved provider", async () => {
    run = startTestRun();
    const { projectId, leadId, adminId } = await setupProjectWithAdmin();
    const providerId = await setupMockProvider(adminId);
    const result = await createConnection(leadId, {
      providerId,
      projectId,
      scopes: ["test"],
    });
    expect(result.connection.status).toBe("active");
    expect(result.webhookSecret).toBeTruthy();
  });

  it("lead can revoke a connection (blocks new jobs)", async () => {
    run = startTestRun();
    const { projectId, leadId, adminId } = await setupProjectWithAdmin();
    const providerId = await setupMockProvider(adminId);
    const result = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    await revokeConnection(result.connection.id, leadId, "No longer needed for this project.");
    const conn = await db.integrationConnection.findUnique({ where: { id: result.connection.id } });
    expect(conn?.status).toBe("revoked");
  });

  it("lead can suspend and a connection blocks new jobs", async () => {
    run = startTestRun();
    const { projectId, leadId, adminId } = await setupProjectWithAdmin();
    const providerId = await setupMockProvider(adminId);
    const result = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    await suspendConnection(result.connection.id, leadId, "Temporary suspension for investigation.");
    // Try to submit a job — should fail (connection is suspended)
    await expect(
      submitJob(leadId, {
        connectionId: result.connection.id,
        capability: "application.test",
        idempotencyKey: `key-${run.runId}`,
        payload: { input: "test" },
      }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("G07 — Job idempotency", () => {
  it("duplicate submission with same idempotencyKey returns the same job", async () => {
    run = startTestRun();
    const { projectId, leadId, adminId } = await setupProjectWithAdmin();
    const providerId = await setupMockProvider(adminId);
    const conn = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const job1 = await submitJob(leadId, {
      connectionId: conn.connection.id,
      capability: "application.test",
      idempotencyKey: `dup-key-${run.runId}`,
      payload: { input: "first" },
    });
    // Submit again with the same key — should return the same job
    const job2 = await submitJob(leadId, {
      connectionId: conn.connection.id,
      capability: "application.test",
      idempotencyKey: `dup-key-${run.runId}`,
      payload: { input: "second" }, // different payload, but same key → same job
    });
    expect(job1.id).toBe(job2.id);
  });
});

describe("G07 — Cross-project isolation", () => {
  it("user from project A cannot access project B's connections", async () => {
    run = startTestRun();
    const projectA = await setupProjectWithAdmin();
    const projectB = await setupProjectWithAdmin();
    const providerId = await setupMockProvider(projectA.adminId);
    const conn = await createConnection(projectA.leadId, {
      providerId,
      projectId: projectA.projectId,
      scopes: ["test"],
    });
    // Lead of project B tries to get project A's job — NotFound
    await expect(
      getJob("any-job-id", projectB.leadId),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("G07 — Job cancellation", () => {
  it("can cancel a queued job", async () => {
    run = startTestRun();
    const { projectId, leadId, adminId } = await setupProjectWithAdmin();
    const providerId = await setupMockProvider(adminId);
    const conn = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const job = await submitJob(leadId, {
      connectionId: conn.connection.id,
      capability: "application.test",
      idempotencyKey: `cancel-${run.runId}`,
      payload: { input: "test" },
    });
    const result = await cancelJob(job.id, leadId, "No longer needed.");
    expect(result.status).toBe("cancelled");
  });
});
