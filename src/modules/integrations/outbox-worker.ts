/**
 * STR Integrations — Durable Outbox Worker (G07)
 * ----------------------------------------------
 * Standalone Node process that processes OutboxEvent records.
 *
 * Per MASTER G07 directive:
 * - Processes OutboxEvent (NOT directly from IntegrationJob)
 * - Atomic claiming prevents two workers from claiming the same job
 * - Recovery of abandoned jobs (worker crash recovery)
 * - Conditional result writing (no overwrite of cancelled/timed_out)
 * - No Redis — PostgreSQL is sufficient
 *
 * Flow:
 *   1. Find next undelivered OutboxEvent (dispatchedAt IS NULL)
 *   2. Atomically claim it (updateMany WHERE dispatchedAt IS NULL)
 *   3. Find the corresponding IntegrationJob by aggregateId
 *   4. Verify the job is still 'queued' (not cancelled while waiting)
 *   5. Atomically claim the job (updateMany WHERE status='queued' AND claimedBy IS NULL)
 *   6. Execute the job via the adapter
 *   7. Write the result conditionally (WHERE status='running' AND claimedBy=WORKER_ID)
 *      — prevents overwriting cancelled/timed_out status
 *   8. Mark the OutboxEvent as dispatched
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAdapter } from "./adapter";
import { getMockAdapter, MOCK_PROVIDER_ID } from "./mock-adapter";

const WORKER_ID = `worker-${process.pid}-${Date.now().toString(36)}`;
const POLL_INTERVAL_MS = 2000;
const RECOVERY_THRESHOLD_MS = 60000;

const mockAdapter = getMockAdapter();

/**
 * Process one OutboxEvent → IntegrationJob cycle.
 * Returns true if a job was processed, false if no work available.
 */
export async function processNextOutboxEvent(): Promise<boolean> {
  // Step 1: Find the next undelivered outbox event
  const outboxEvent = await db.outboxEvent.findFirst({
    where: { dispatchedAt: null, aggregate: "integration.job" },
    orderBy: { createdAt: "asc" },
    select: { id: true, aggregateId: true, type: true },
  });
  if (!outboxEvent) return false;

  // Step 2: Atomically claim the outbox event
  const claimed = await db.outboxEvent.updateMany({
    where: { id: outboxEvent.id, dispatchedAt: null },
    data: { dispatchedAt: new Date() },
  });
  if (claimed.count === 0) return false; // another worker claimed it

  // Step 3: Find the corresponding IntegrationJob
  const jobId = outboxEvent.aggregateId;
  const job = await db.integrationJob.findUnique({
    where: { id: jobId },
    select: { id: true, connectionId: true, capability: true, payload: true, idempotencyKey: true, timeoutMs: true, status: true },
  });
  if (!job) {
    logger.warn("outbox.job.not_found", { jobId, outboxEventId: outboxEvent.id });
    return true;
  }

  // Step 4: If the job was cancelled while waiting, don't execute it
  if (job.status !== "queued") {
    logger.info("outbox.job.skipped", { jobId, status: job.status });
    return true;
  }

  // Step 5: Atomically claim the job (only if still queued)
  const claimedJob = await db.integrationJob.updateMany({
    where: { id: jobId, status: "queued" },
    data: {
      status: "running",
      claimedBy: WORKER_ID,
      claimedAt: new Date(),
      startedAt: new Date(),
      timeoutAt: new Date(Date.now() + job.timeoutMs),
    },
  });
  if (claimedJob.count === 0) {
    // Another worker already claimed it or it was cancelled
    logger.info("outbox.job.already_claimed", { jobId });
    return true;
  }

  // Step 6: Get the connection + provider to find the adapter
  const connection = await db.integrationConnection.findUnique({
    where: { id: job.connectionId },
    include: { provider: true },
  });
  if (!connection || connection.status !== "active") {
    // Connection revoked/suspended — mark job as failed (conditional update)
    await db.integrationJob.updateMany({
      where: { id: jobId, status: "running", claimedBy: WORKER_ID },
      data: {
        status: "failed",
        failureCategory: "connection_revoked",
        failureMessage: `Connection is ${connection?.status ?? "not_found"}`,
        retryable: false,
        finishedAt: new Date(),
      },
    });
    logger.warn("outbox.job.connection_revoked", { jobId });
    return true;
  }

  // Step 7: Get the adapter
  let adapter = getAdapter(connection.providerId);
  if (!adapter && connection.providerId === MOCK_PROVIDER_ID) {
    adapter = mockAdapter;
  }
  if (!adapter) {
    await db.integrationJob.updateMany({
      where: { id: jobId, status: "running", claimedBy: WORKER_ID },
      data: {
        status: "failed",
        failureCategory: "adapter_not_found",
        failureMessage: `No adapter for ${connection.providerId}`,
        retryable: false,
        finishedAt: new Date(),
      },
    });
    return true;
  }

  // Step 8: Execute the job
  try {
    const result = await adapter.executeJob({
      capability: job.capability,
      payload: job.payload as Record<string, unknown>,
      timeoutMs: job.timeoutMs,
      idempotencyKey: job.idempotencyKey,
    });

    // Step 9: Write the result CONDITIONALLY
    // Only update if the job is still 'running' AND claimed by THIS worker
    // This prevents overwriting 'cancelled' or 'timed_out' status
    const updated = await db.integrationJob.updateMany({
      where: { id: jobId, status: "running", claimedBy: WORKER_ID },
      data: {
        status: result.status === "succeeded" ? "succeeded" : result.status,
        result: (result.result ?? null) as never,
        failureCategory: result.failureCategory,
        failureMessage: result.failureMessage,
        retryable: result.retryable,
        finishedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      // Job was cancelled or timed out while we were executing
      logger.info("outbox.job.completed_but_overwritten", {
        jobId,
        expectedStatus: result.status,
      });
    } else {
      logger.info("outbox.job.completed", { jobId, status: result.status });
    }
  } catch (e) {
    // Unexpected error — write failure conditionally
    await db.integrationJob.updateMany({
      where: { id: jobId, status: "running", claimedBy: WORKER_ID },
      data: {
        status: "failed",
        failureCategory: "unexpected_error",
        failureMessage: e instanceof Error ? e.message : String(e),
        retryable: true,
        finishedAt: new Date(),
      },
    });
    logger.error("outbox.job.error", { jobId, error: e instanceof Error ? e.message : String(e) });
  }

  return true;
}

/**
 * Recover abandoned jobs (worker crashed during execution).
 */
export async function recoverAbandonedJobs(): Promise<number> {
  const recovered = await db.integrationJob.updateMany({
    where: {
      status: "running",
      claimedAt: { lt: new Date(Date.now() - RECOVERY_THRESHOLD_MS) },
    },
    data: {
      status: "queued",
      claimedBy: null,
      claimedAt: null,
      startedAt: null,
      timeoutAt: null,
    },
  });
  if (recovered.count > 0) {
    logger.info("outbox.recovery", { recoveredCount: recovered.count });
  }
  return recovered.count;
}

/**
 * Check for timed-out jobs.
 */
export async function checkTimeouts(): Promise<number> {
  const timedOut = await db.integrationJob.updateMany({
    where: { status: "running", timeoutAt: { lt: new Date() } },
    data: {
      status: "timed_out",
      failureCategory: "timeout",
      failureMessage: "Job exceeded timeout",
      retryable: true,
      finishedAt: new Date(),
    },
  });
  if (timedOut.count > 0) {
    logger.info("outbox.timeout", { timedOutCount: timedOut.count });
  }
  return timedOut.count;
}

/**
 * Main worker loop (for standalone process).
 */
export async function runWorkerLoop(): Promise<void> {
  logger.info("outbox.worker.start", { workerId: WORKER_ID });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await recoverAbandonedJobs();
      await checkTimeouts();
      const hadJob = await processNextOutboxEvent();
      if (!hadJob) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (e) {
      logger.error("outbox.worker.error", { error: e instanceof Error ? e.message : String(e) });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

if (require.main === module) {
  runWorkerLoop().catch((e) => {
    logger.error("outbox.worker.fatal", { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
}
