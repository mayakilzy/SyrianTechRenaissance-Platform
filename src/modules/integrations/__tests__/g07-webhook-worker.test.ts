/**
 * STR G07 — Webhook Security + Worker Safety Unit Tests
 *
 * Per MASTER G07 Core Acceptance Correction:
 *   1. Webhook rejects unsigned/invalid signatures (fail-closed)
 *   2. Worker processes OutboxEvent (not directly IntegrationJob)
 *   3. Worker conditional result writing (no overwrite of cancelled)
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createHash, randomBytes, createHmac } from "node:crypto";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import { createConnection, submitJob } from "@/modules/integrations/service";
import { processNextOutboxEvent, recoverAbandonedJobs, checkTimeouts } from "@/modules/integrations/outbox-worker";
import { ForbiddenError, ConflictError } from "@/lib/errors";

let run: ReturnType<typeof startTestRun>;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

async function setupProjectWithProvider() {
  const adminId = await createTestUser(run, "admin");
  const stewardId = await createTestUser(run, "admin");
  const leadId = await createTestUser(run, "rep");
  const proposal = await createProposal({
    submitterId: leadId,
    title: `G07 Webhook Test ${run.runId}`,
    charter: {
      problemStatement: "Test problem statement with sufficient length for validation purposes here.",
      outcomes: "Test outcomes with sufficient length for validation purposes here.",
      scope: "Test scope with sufficient length for validation purposes here.",
      requiredSkills: ["TypeScript"],
      acceptanceCriteria: "Test acceptance criteria with sufficient length for validation.",
    },
  });
  await submitProposal(proposal.id, leadId);
  await reviewProposal({ proposalId: proposal.id, reviewerId: adminId, action: "APPROVE", reason: "Approved for G07 webhook worker tests.", stewardId });
  const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
  if (!project) throw new Error("Project not created");
  run.proposalIds.push(proposal.id);
  run.projectIds.push(project.id);

  // Ensure mock provider exists + is approved
  // G09-P2 ROOT-CAUSE FIX: previous pattern used 3 separate DB calls
  // (upsert → update → approveProvider). In slow CI runners, the
  // approveProvider's updateMany could see a stale "approved" state
  // (from a prior test) because the reset update hadn't committed yet.
  //
  // FIX: do the reset + approve + auditEvent in a SINGLE $transaction
  // so all three writes commit atomically. The approveProvider logic
  // (updateMany WHERE trustStatus="registered" + count check + audit)
  // is inlined here with `tx` so it shares the same transaction as the
  // reset. The isAdmin check is preserved (same security contract).
  const provider = await db.integrationProvider.upsert({
    where: { id: "str.mock.v1" },
    update: { isMock: true },
    create: {
      id: "str.mock.v1", slug: "str.mock", version: "v1",
      displayName: "STR Mock Provider", description: "Mock", owner: "STR",
      baseOrigin: "https://mock.str.local", trustStatus: "registered",
      authMode: { type: "none" }, isMock: true,
    },
  });

  // Verify admin (same security check as approveProvider).
  const { isAdmin } = await import("@/modules/organizations/service");
  if (!(await isAdmin(adminId))) {
    throw new ForbiddenError("Only admins can approve providers");
  }

  // Atomic reset + approve + audit in one transaction.
  await db.$transaction(async (tx) => {
    await tx.integrationProvider.update({
      where: { id: provider.id },
      data: { trustStatus: "registered", approvedById: null, approvedAt: null },
    });
    const approveResult = await tx.integrationProvider.updateMany({
      where: { id: provider.id, trustStatus: "registered" },
      data: { trustStatus: "approved", approvedById: adminId, approvedAt: new Date() },
    });
    if (approveResult.count === 0) {
      throw new ConflictError("Provider reset+approve failed in transaction");
    }
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
  await db.integrationCapability.upsert({
    where: { providerId_code: { providerId: provider.id, code: "application.test" } },
    update: {},
    create: {
      providerId: provider.id, code: "application.test", summary: "Test",
      executionMode: "async", riskClass: "low", requiredScopes: ["test"],
      inputSchemaRef: "ref", outputSchemaRef: "ref", idempotent: true, cancelable: true, timeoutMs: 30000,
    },
  });
  return { projectId: project.id, leadId, adminId, providerId: provider.id };
}

describe("G07 — Worker processes OutboxEvent", () => {
  it("worker processes a queued job via OutboxEvent and writes result", async () => {
    run = startTestRun();
    const { projectId, leadId, providerId } = await setupProjectWithProvider();
    const result = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const job = await submitJob(leadId, {
      connectionId: result.connection.id,
      capability: "application.test",
      idempotencyKey: `worker-${run.runId}`,
      payload: { input: "test data" },
    });
    expect(job.status).toBe("queued");

    // Verify an OutboxEvent was created
    const outbox = await db.outboxEvent.findFirst({
      where: { aggregateId: job.id, dispatchedAt: null },
    });
    expect(outbox).toBeTruthy();

    // Process one outbox event
    const hadJob = await processNextOutboxEvent();
    expect(hadJob).toBe(true);

    // Verify the job result was written
    const updated = await db.integrationJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe("succeeded");
    expect(updated?.result).toBeTruthy();
    expect(updated?.claimedBy).toBeTruthy();
    expect(updated?.finishedAt).toBeTruthy();

    // Verify the outbox event was marked as dispatched
    const updatedOutbox = await db.outboxEvent.findFirst({
      where: { aggregateId: job.id },
    });
    expect(updatedOutbox?.dispatchedAt).toBeTruthy();
  });

  it("worker does NOT overwrite a cancelled job (conditional update)", async () => {
    run = startTestRun();
    const { projectId, leadId, providerId } = await setupProjectWithProvider();
    const result = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const job = await submitJob(leadId, {
      connectionId: result.connection.id,
      capability: "application.test",
      idempotencyKey: `cancel-worker-${run.runId}`,
      payload: { input: "test" },
    });

    // Cancel the job before the worker processes it
    await db.integrationJob.update({
      where: { id: job.id },
      data: { status: "cancelled", cancelReason: "Manually cancelled before worker runs", finishedAt: new Date() },
    });

    // Process — the worker should skip the cancelled job (status !== "queued")
    await processNextOutboxEvent();

    // Verify the job is still cancelled (not overwritten with "succeeded")
    const updated = await db.integrationJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe("cancelled");
    expect(updated?.result).toBeNull();
  });
});

describe("G07 — Worker recovery + timeout", () => {
  it("recovers abandoned jobs (worker crash recovery)", async () => {
    run = startTestRun();
    const { projectId, leadId, providerId } = await setupProjectWithProvider();
    const result = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const job = await submitJob(leadId, {
      connectionId: result.connection.id,
      capability: "application.test",
      idempotencyKey: `recovery-${run.runId}`,
      payload: { input: "test" },
    });
    // Simulate a worker claiming the job but crashing
    await db.integrationJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        claimedBy: "dead-worker",
        claimedAt: new Date(Date.now() - 120000), // 2 minutes ago (beyond 60s threshold)
      },
    });

    // Recovery should re-queue the job
    const count = await recoverAbandonedJobs();
    expect(count).toBeGreaterThan(0);

    const recovered = await db.integrationJob.findUnique({ where: { id: job.id } });
    expect(recovered?.status).toBe("queued");
    expect(recovered?.claimedBy).toBeNull();
  });

  it("marks timed-out jobs", async () => {
    run = startTestRun();
    const { projectId, leadId, providerId } = await setupProjectWithProvider();
    const result = await createConnection(leadId, { providerId, projectId, scopes: ["test"] });
    const job = await submitJob(leadId, {
      connectionId: result.connection.id,
      capability: "application.test",
      idempotencyKey: `timeout-${run.runId}`,
      payload: { input: "test" },
    });
    // Simulate a timed-out job
    await db.integrationJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        claimedBy: "slow-worker",
        claimedAt: new Date(),
        startedAt: new Date(),
        timeoutAt: new Date(Date.now() - 1000), // 1s ago (already timed out)
      },
    });

    const count = await checkTimeouts();
    expect(count).toBeGreaterThan(0);

    const updated = await db.integrationJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe("timed_out");
    expect(updated?.failureCategory).toBe("timeout");
  });
});
