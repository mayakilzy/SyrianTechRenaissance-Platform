/**
 * STR Integrations — Durable Outbox Worker (G07)
 * ----------------------------------------------
 * Standalone Node process that polls the OutboxEvent table for undelivered
 * events and processes IntegrationJobs.
 *
 * Per MASTER G07 directive:
 * - Standalone process (NOT setInterval inside Next.js)
 * - Atomic job claiming (prevents two workers from claiming the same job)
 * - Recovery of abandoned jobs (worker crash recovery)
 * - No Redis — PostgreSQL is sufficient
 *
 * Usage:
 *   bun run src/modules/integrations/outbox-worker.ts
 *
 * The worker runs in a loop:
 *   1. Claim a queued job atomically (UPDATE WHERE status='queued' SET claimedBy, claimedAt)
 *   2. Execute the job via the adapter
 *   3. Update the job with the result
 *   4. If timeout exceeded, mark as timed_out
 *   5. Recover abandoned jobs (claimed but not finished after timeout)
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAdapter } from "./adapter";
import { getMockAdapter, MOCK_PROVIDER_ID } from "./mock-adapter";

const WORKER_ID = `worker-${process.pid}-${Date.now().toString(36)}`;
const POLL_INTERVAL_MS = 2000; // 2 seconds
const RECOVERY_THRESHOLD_MS = 60000; // 60s — if a job has been claimed for >60s without finishing, recover it

// Register the mock adapter at startup
const mockAdapter = getMockAdapter();

export async function claimAndExecuteJob(): Promise<boolean> {
  // Step 1: Find the next queued job
  const nextJob = await db.integrationJob.findFirst({
    where: { status: "queued" },
    orderBy: { queuedAt: "asc" },
    select: { id: true, connectionId: true, capability: true, payload: true, idempotencyKey: true, timeoutMs: true },
  });
  if (!nextJob) return false;

  // Step 2: Atomic claim — only update if still queued (optimistic lock)
  const claimed = await db.integrationJob.updateMany({
    where: { id: nextJob.id, status: "queued" },
    data: {
      status: "running",
      claimedBy: WORKER_ID,
      claimedAt: new Date(),
      startedAt: new Date(),
      timeoutAt: new Date(Date.now() + nextJob.timeoutMs),
    },
  });
  if (claimed.count === 0) return false; // another worker claimed it first

  const job = nextJob;

  // Get the connection to find the provider
  const connection = await db.integrationConnection.findUnique({
    where: { id: job.connectionId },
    include: { provider: true },
  });

  if (!connection || connection.status !== "active") {
    // Connection revoked or suspended — mark job as failed
    await db.integrationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        failureCategory: "connection_revoked",
        failureMessage: `Connection is ${connection?.status ?? "not_found"}; job cannot execute`,
        retryable: false,
        finishedAt: new Date(),
      },
    });
    logger.warn("outbox.job.connection_revoked", { jobId: job.id, connectionId: job.connectionId });
    return true;
  }

  // Get the adapter (mock or real)
  let adapter = getAdapter(connection.providerId);
  if (!adapter && connection.providerId === MOCK_PROVIDER_ID) {
    adapter = mockAdapter;
  }
  if (!adapter) {
    await db.integrationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        failureCategory: "adapter_not_found",
        failureMessage: `No adapter registered for provider ${connection.providerId}`,
        retryable: false,
        finishedAt: new Date(),
      },
    });
    logger.error("outbox.job.adapter_not_found", { jobId: job.id, providerId: connection.providerId });
    return true;
  }

  // Execute the job
  try {
    const result = await adapter.executeJob({
      capability: job.capability,
      payload: job.payload as Record<string, unknown>,
      timeoutMs: job.timeoutMs,
      idempotencyKey: job.idempotencyKey,
    });

    await db.integrationJob.update({
      where: { id: job.id },
      data: {
        status: result.status === "succeeded" ? "succeeded" : result.status,
        result: result.result ?? undefined,
        failureCategory: result.failureCategory,
        failureMessage: result.failureMessage,
        retryable: result.retryable,
        finishedAt: new Date(),
      },
    });

    logger.info("outbox.job.completed", {
      jobId: job.id,
      status: result.status,
      capability: job.capability,
    });
  } catch (e) {
    // Unexpected error during execution
    await db.integrationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        failureCategory: "unexpected_error",
        failureMessage: e instanceof Error ? e.message : String(e),
        retryable: true,
        finishedAt: new Date(),
      },
    });
    logger.error("outbox.job.error", { jobId: job.id, error: e instanceof Error ? e.message : String(e) });
  }

  return true;
}

export async function recoverAbandonedJobs(): Promise<number> {
  // Find jobs that have been claimed but not finished after the recovery threshold
  // (likely the worker crashed)
  const recovered = await db.integrationJob.updateMany({
    where: {
      status: "running",
      claimedAt: { lt: new Date(Date.now() - RECOVERY_THRESHOLD_MS) },
    },
    data: {
      status: "queued", // re-queue
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

export async function checkTimeouts(): Promise<number> {
  // Find jobs that have exceeded their timeout and mark as timed_out
  const timedOut = await db.integrationJob.updateMany({
    where: {
      status: "running",
      timeoutAt: { lt: new Date() },
    },
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

export async function runWorkerLoop(): Promise<void> {
  logger.info("outbox.worker.start", { workerId: WORKER_ID });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await recoverAbandonedJobs();
      await checkTimeouts();
      const hadJob = await claimAndExecuteJob();
      if (!hadJob) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (e) {
      logger.error("outbox.worker.error", { error: e instanceof Error ? e.message : String(e) });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

// If run directly (not imported), start the worker loop
if (require.main === module) {
  runWorkerLoop().catch((e) => {
    logger.error("outbox.worker.fatal", { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
}
