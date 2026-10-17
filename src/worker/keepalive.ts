/**
 * STR Platform — Worker keepalive (G01 placeholder)
 * --------------------------------------------------
 * The real outbox dispatcher lands in G07 (ADR-02). For G01 we keep the
 * process alive so `docker compose up` shows a healthy worker container and
 * the topology is demonstrable. This file is intentionally tiny.
 */

import { logger } from "@/lib/logger";

logger.info("worker.keepalive.start", {
  note: "G01 placeholder — outbox dispatcher arrives in G07 (ADR-04).",
});

// Health heartbeat every 60s so logs prove the process is alive.
setInterval(() => {
  logger.info("worker.keepalive.heartbeat");
}, 60_000);
