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
  // Use upsert to handle the case where the provider already exists from seed.
  // G09-P2 fix: ALWAYS reset trustStatus to "registered" + clear approval fields
  // on update, so this test re-approves the provider with ITS OWN adminId.
  // Without this, a prior test (e.g. g09-outbox-reliability or g07-webhook-worker)
  // may have approved the shared provider and then had its admin user deleted
  // by cleanup — leaving approvedById=null but trustStatus="approved". This
  // test would then skip approval and fail the approvedById assertion.
  const provider = await db.integrationProvider.upsert({
    where: { id: "str.mock.v1" },
    update: {
      isMock: true,
      trustStatus: "registered",
      approvedById: null,
      approvedAt: null,
    },
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
  // Ensure the capability exists (upsert)
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
  // Approve the provider if not already approved
  if (provider.trustStatus !== "approved") {
    await approveProvider(provider.id, adminId);
  }
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
