/**
 * STR Integrations — Durable Outbox Worker (G07)
 * ----------------------------------------------
 * Standalone Node process with LEASE MECHANISM for durable recovery.
 *
 * Per MASTER G07 FINAL DURABILITY directive:
 * - dispatchedAt is set ONLY after the job is fully processed (not at claim)
 * - Lease: claimedAt/claimedBy track who's working on the event
 * - Recovery: re-queue events where claimedAt is stale but dispatchedAt is null
 * - Sync recovery: when re-queuing a job, also re-queue its OutboxEvent
 * - Conditional result writing (no overwrite of cancelled/timed_out)
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAdapter } from "./adapter";
import { getMockAdapter, MOCK_PROVIDER_ID } from "./mock-adapter";

const WORKER_ID = `worker-${process.pid}-${Date.now().toString(36)}`;
const POLL_INTERVAL_MS = 2000;
const RECOVERY_THRESHOLD_MS = 60000;

const mockAdapter = getMockAdapter();

export async function processNextOutboxEvent(): Promise<boolean> {
  // Step 1: Find next unclaimed or stale-claimed outbox event
  // (dispatchedAt IS NULL = not yet processed)
  // (claimedAt IS NULL = never claimed) OR (claimedAt < threshold = stale/abandoned)
  const staleThreshold = new Date(Date.now() - RECOVERY_THRESHOLD_MS);
  const outboxEvent = await db.outboxEvent.findFirst({
    where: {
      dispatchedAt: null,
      aggregate: "integration.job",
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: staleThreshold } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, aggregateId: true, type: true, claimedBy: true },
  });
  if (!outboxEvent) return false;

  // Step 2: Atomically CLAIM the outbox event (lease)
  // Only claim if: dispatchedAt is null AND (not claimed OR stale claim)
  const claimed = await db.outboxEvent.updateMany({
    where: {
      id: outboxEvent.id,
      dispatchedAt: null,
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: staleThreshold } },
      ],
    },
    data: { claimedAt: new Date(), claimedBy: WORKER_ID },
  });
  if (claimed.count === 0) return false; // another worker claimed it

  // Step 3: Find the corresponding IntegrationJob
  const jobId = outboxEvent.aggregateId;
  const job = await db.integrationJob.findUnique({
    where: { id: jobId },
    select: { id: true, connectionId: true, capability: true, payload: true, idempotencyKey: true, timeoutMs: true, status: true },
  });
  if (!job) {
    // Mark the outbox event as dispatched (job doesn't exist — nothing to do)
    await db.outboxEvent.updateMany({
      where: { id: outboxEvent.id, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    });
    logger.warn("outbox.job.not_found", { jobId });
    return true;
  }

  // Step 4: Skip if job was cancelled/timed_out while waiting
  if (job.status !== "queued") {
    // Mark the outbox event as dispatched (job already handled)
    await db.outboxEvent.updateMany({
      where: { id: outboxEvent.id, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    });
    logger.info("outbox.job.skipped", { jobId, status: job.status });
    return true;
  }

  // Step 5: Atomically claim the IntegrationJob (only if still queued)
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
    // Another worker claimed it or it was cancelled — mark outbox as dispatched
    await db.outboxEvent.updateMany({
      where: { id: outboxEvent.id, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    });
    return true;
  }

  // Step 6: Get connection + adapter
  const connection = await db.integrationConnection.findUnique({
    where: { id: job.connectionId },
    include: { provider: true },
  });
  if (!connection || connection.status !== "active") {
    await db.integrationJob.updateMany({
      where: { id: jobId, status: "running", claimedBy: WORKER_ID },
      data: { status: "failed", failureCategory: "connection_revoked", failureMessage: `Connection ${connection?.status ?? "not_found"}`, retryable: false, finishedAt: new Date() },
    });
    // Mark outbox as dispatched
    await db.outboxEvent.update({ where: { id: outboxEvent.id }, data: { dispatchedAt: new Date() } });
    return true;
  }

  let adapter = getAdapter(connection.providerId);
  if (!adapter && connection.providerId === MOCK_PROVIDER_ID) adapter = mockAdapter;
  if (!adapter) {
    await db.integrationJob.updateMany({
      where: { id: jobId, status: "running", claimedBy: WORKER_ID },
      data: { status: "failed", failureCategory: "adapter_not_found", failureMessage: `No adapter for ${connection.providerId}`, retryable: false, finishedAt: new Date() },
    });
    await db.outboxEvent.update({ where: { id: outboxEvent.id }, data: { dispatchedAt: new Date() } });
    return true;
  }

  // Step 7: Execute the job
  try {
    const result = await adapter.executeJob({
      capability: job.capability,
      payload: job.payload as Record<string, unknown>,
      timeoutMs: job.timeoutMs,
      idempotencyKey: job.idempotencyKey,
    });

    // Step 8: Write result CONDITIONALLY (no overwrite of cancelled/timed_out)
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
      logger.info("outbox.job.completed_but_overwritten", { jobId, expectedStatus: result.status });
    } else {
      logger.info("outbox.job.completed", { jobId, status: result.status });
    }
  } catch (e) {
    await db.integrationJob.updateMany({
      where: { id: jobId, status: "running", claimedBy: WORKER_ID },
      data: { status: "failed", failureCategory: "unexpected_error", failureMessage: e instanceof Error ? e.message : String(e), retryable: true, finishedAt: new Date() },
    });
    logger.error("outbox.job.error", { jobId, error: e instanceof Error ? e.message : String(e) });
  }

  // Step 9: Mark the OutboxEvent as dispatched (AFTER processing is complete)
  // This is the KEY FIX: dispatchedAt is set only after the job finishes,
  // not when the event is claimed. If the worker crashes after claiming
  // but before finishing, the recovery will re-queue the outbox event.
  await db.outboxEvent.update({
    where: { id: outboxEvent.id },
    data: { dispatchedAt: new Date() },
  });

  return true;
}

/**
 * Recover abandoned outbox events (worker crashed after claiming but before completing).
 * Re-queues events where claimedAt is stale but dispatchedAt is still null.
 */
export async function recoverAbandonedOutboxEvents(): Promise<number> {
  const staleThreshold = new Date(Date.now() - RECOVERY_THRESHOLD_MS);
  const recovered = await db.outboxEvent.updateMany({
    where: { dispatchedAt: null, claimedAt: { lt: staleThreshold } },
    data: { claimedAt: null, claimedBy: null },
  });
  if (recovered.count > 0) logger.info("outbox.recovery.events", { count: recovered.count });
  return recovered.count;
}

/**
 * Recover abandoned IntegrationJobs (worker crashed during execution).
 * Also syncs with OutboxEvent recovery.
 */
export async function recoverAbandonedJobs(): Promise<number> {
  // Recover stale running jobs → re-queue
  const recovered = await db.integrationJob.updateMany({
    where: { status: "running", claimedAt: { lt: new Date(Date.now() - RECOVERY_THRESHOLD_MS) } },
    data: { status: "queued", claimedBy: null, claimedAt: null, startedAt: null, timeoutAt: null },
  });
  if (recovered.count > 0) logger.info("outbox.recovery.jobs", { count: recovered.count });

  // Also recover stale outbox events
  await recoverAbandonedOutboxEvents();

  return recovered.count;
}

export async function checkTimeouts(): Promise<number> {
  const timedOut = await db.integrationJob.updateMany({
    where: { status: "running", timeoutAt: { lt: new Date() } },
    data: { status: "timed_out", failureCategory: "timeout", failureMessage: "Job exceeded timeout", retryable: true, finishedAt: new Date() },
  });
  if (timedOut.count > 0) logger.info("outbox.timeout", { count: timedOut.count });
  return timedOut.count;
}

/**
 * Cancellation-aware sleep helper.
 *
 * Returns a promise that resolves after `ms` milliseconds OR when the
 * AbortSignal fires — whichever comes first.
 *
 * G10-01 FINAL HARDENING: this replaces the inline Promise.race pattern
 * that leaked timers and event listeners. This helper guarantees:
 *   1. The setTimeout is cleared on abort (no dangling timer).
 *   2. The abort listener is removed on timeout (no dangling listener).
 *   3. No resource accumulation across loop iterations.
 */
function cancellableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run the outbox worker loop until the abort signal fires.
 *
 * G10-01 FINAL HARDENING: graceful shutdown via AbortSignal.
 * - SIGTERM/SIGINT triggers abort → loop exits after current iteration.
 * - Abort is checked at THREE points each iteration:
 *   1. Top of while loop (before recovery)
 *   2. After recovery + timeout checks (before claiming a new job)
 *   3. During poll sleep (interruptible via cancellableSleep)
 * - No new job is claimed after abort is requested.
 * - The poll sleep uses cancellableSleep — no timer/listener leaks.
 * - In-flight job processing completes naturally; the lease mechanism
 *   ensures recovery if the process is killed before completion.
 * - After the loop exits, the function returns (worker exits cleanly).
 *
 * @param signal Optional AbortSignal. When aborted, the loop stops.
 *               If not provided, the loop runs forever (backwards compat
 *               for tests that call runWorkerLoop() directly).
 */
export async function runWorkerLoop(signal?: AbortSignal): Promise<void> {
  logger.info("outbox.worker.start", { workerId: WORKER_ID, hasAbortSignal: !!signal });

  while (!signal?.aborted) {
    try {
      await recoverAbandonedJobs();
      await checkTimeouts();

      // G10-01 FINAL HARDENING: check abort BEFORE claiming a new job.
      // Recovery and timeout checks may take time; the signal could have
      // fired during those operations. Do NOT claim a new job if aborting.
      if (signal?.aborted) {
        break;
      }

      const hadJob = await processNextOutboxEvent();
      if (!hadJob) {
        await cancellableSleep(POLL_INTERVAL_MS, signal);
      }
    } catch (e) {
      logger.error("outbox.worker.error", { error: e instanceof Error ? e.message : String(e) });
      await cancellableSleep(POLL_INTERVAL_MS, signal);
    }
  }

  logger.info("outbox.worker.shutdown.complete", { workerId: WORKER_ID });
}

if (require.main === module) {
  runWorkerLoop().catch((e) => {
    logger.error("outbox.worker.fatal", { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
}
