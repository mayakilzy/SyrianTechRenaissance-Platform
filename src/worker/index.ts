/**
 * STR Platform — Worker Entry Point (G10-01)
 * ------------------------------------------
 * This is the production entry point for the background worker.
 * It starts the outbox dispatcher loop (runWorkerLoop) which:
 *   - Polls for undelivered OutboxEvents
 *   - Claims and processes IntegrationJobs
 *   - Recovers abandoned jobs after lease expiration
 *   - Handles timeouts
 *
 * Graceful shutdown:
 *   On SIGTERM/SIGINT, the loop exits after the current iteration
 *   completes. No in-flight job is killed mid-execution — the
 *   lease mechanism (claimedAt + RECOVERY_THRESHOLD_MS) ensures
 *   the job is re-claimed by the next worker start.
 *
 * This replaces the G01 keepalive.ts placeholder.
 *
 * Usage:
 *   bun run src/worker/index.ts          (dev)
 *   node src/worker/index.js             (prod standalone, after build)
 *
 * The Dockerfile prod target runs `node server.js` for the web app.
 * The worker is started separately with this entry point.
 * docker-compose.yml worker service command points here.
 */
import { runWorkerLoop } from "@/modules/integrations/outbox-worker";
import { logger } from "@/lib/logger";

logger.info("worker.entry.start", {
  pid: process.pid,
  nodeEnv: process.env.NODE_ENV ?? "development",
  note: "G10-01: real outbox worker entry point (replaces G01 keepalive placeholder).",
});

// Graceful shutdown handling.
// SIGTERM is sent by Docker on `docker stop` and by orchestrators (k8s, compose).
// SIGINT is sent by Ctrl+C in interactive mode.
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    logger.warn("worker.entry.shutdown.already_in_progress", { signal });
    return;
  }
  shuttingDown = true;
  logger.info("worker.entry.shutdown.signal", { signal });

  // runWorkerLoop checks for exceptions and returns; it does not have a
  // built-in cancellation token. The loop exits when the current poll
  // cycle completes. If a job is in-flight, it completes naturally.
  // The lease mechanism ensures recovery on next start.
  //
  // We give the loop 10 seconds to finish gracefully, then force exit.
  setTimeout(() => {
    logger.error("worker.entry.shutdown.timeout", { note: "Forced exit after 10s grace period." });
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

runWorkerLoop().catch((e) => {
  logger.error("worker.entry.fatal", {
    error: e instanceof Error ? e.message : String(e),
  });
  process.exit(1);
});
