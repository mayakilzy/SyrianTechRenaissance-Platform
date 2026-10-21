/**
 * STR Platform — Worker Entry Point (G10-01 + G10-01V-FIX)
 * ----------------------------------------------------------
 * This is the production entry point for the background worker.
 * It starts the outbox dispatcher loop (runWorkerLoop) which:
 *   - Polls for undelivered OutboxEvents
 *   - Claims and processes IntegrationJobs
 *   - Recovers abandoned jobs after lease expiration
 *   - Handles timeouts
 *
 * Graceful shutdown (G10-01V-FIX):
 *   On SIGTERM/SIGINT, an AbortController is triggered. runWorkerLoop
 *   checks the AbortSignal at the top of each loop iteration and during
 *   the poll sleep. The loop exits cleanly after the current iteration
 *   completes (no new job is claimed after abort).
 *
 *   In-flight job processing completes naturally. If the process is
 *   killed before completion, the lease mechanism (claimedAt +
 *   RECOVERY_THRESHOLD_MS) ensures the job is re-claimed on next start.
 *
 *   A 30-second forced-exit timer is a LAST RESORT safeguard — it
 *   only fires if the graceful shutdown takes too long (e.g., a
 *   long-running adapter.executeJob call that doesn't respond to
 *   the abort within the timeout).
 *
 * This replaces the G01 keepalive.ts placeholder.
 *
 * Usage:
 *   bun run src/worker/index.ts          (dev)
 *   node src/worker/index.js             (prod standalone, after build)
 */
import { runWorkerLoop } from "@/modules/integrations/outbox-worker";
import { logger } from "@/lib/logger";

logger.info("worker.entry.start", {
  pid: process.pid,
  nodeEnv: process.env.NODE_ENV ?? "development",
  note: "G10-01V-FIX: real outbox worker with AbortSignal-based graceful shutdown.",
});

// AbortController for graceful shutdown.
// SIGTERM/SIGINT triggers abort() → runWorkerLoop exits after current iteration.
const abortController = new AbortController();
let shuttingDown = false;

const FORCE_EXIT_TIMEOUT_MS = 30_000; // 30s last-resort safeguard

function shutdown(signal: string): void {
  if (shuttingDown) {
    logger.warn("worker.entry.shutdown.already_in_progress", { signal });
    return;
  }
  shuttingDown = true;
  logger.info("worker.entry.shutdown.signal", { signal });

  // Trigger the abort signal — runWorkerLoop will exit after the
  // current iteration completes (or immediately if sleeping).
  abortController.abort();

  // Last-resort forced exit: if graceful shutdown takes too long
  // (e.g., a long-running adapter.executeJob), force-exit after 30s.
  // This is NOT the normal shutdown path — it's a safeguard.
  setTimeout(() => {
    logger.error("worker.entry.shutdown.timeout", {
      note: `Forced exit after ${FORCE_EXIT_TIMEOUT_MS / 1000}s grace period.`,
    });
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

runWorkerLoop(abortController.signal)
  .then(() => {
    logger.info("worker.entry.shutdown.success", {
      note: "runWorkerLoop returned cleanly after graceful shutdown.",
    });
    process.exit(0);
  })
  .catch((e) => {
    logger.error("worker.entry.fatal", {
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  });
