/**
 * STR Platform — Liveness Health Endpoint (G10-01)
 * -------------------------------------------------
 * Returns 200 as long as the process is alive.
 * Does NOT check the database — liveness means "the process can
 * respond to HTTP requests." Even if the DB is down, this returns 200.
 *
 * Use this for orchestrator liveness probes (e.g., Docker healthcheck,
 * k8s livenessProbe). If this fails, the orchestrator restarts the container.
 *
 * For readiness (can the app serve traffic?), use /api/v1/ready instead.
 */
import { apiSuccess } from "@/lib/api-response";
import { env } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const body = {
    status: "ok",
    app: env.APP_NAME,
    version: env.APP_VERSION,
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    probe: "liveness",
    checks: {
      // Liveness does NOT check DB. If the process is alive, it's "ok".
      // This prevents orchestrator restarts when the DB is temporarily down.
      database: "not_checked" as const,
    },
  };
  return apiSuccess(body, 200);
}
