/**
 * STR Platform — Readiness Probe (G10-01)
 * ----------------------------------------
 * Returns 200 only if the app is ready to serve traffic (DB reachable).
 * Returns 503 if the database is unavailable.
 *
 * Use this for orchestrator readiness probes (e.g., k8s readinessProbe,
 * load balancer health checks). If this fails, traffic is NOT routed
 * to this instance (but the container is NOT restarted — that's
 * liveness's job).
 *
 * DB check: runs `SELECT 1` with a 2-second timeout. If it succeeds,
 * the app is ready. If it throws (DB down, network issue, auth failure),
 * the app is NOT ready.
 *
 * Compatibility: the original /api/v1/health endpoint still exists as
 * liveness. This is a NEW endpoint — no existing contract is broken.
 */
import { NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api-response";
import { env } from "@/lib/config";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let databaseStatus: "ok" | "unavailable" = "ok";
  let databaseError: string | undefined;

  try {
    // 2-second timeout on the DB ping. If the DB doesn't respond in 2s,
    // it's effectively unavailable for serving traffic.
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB ping timeout (2s)")), 2_000),
      ),
    ]);
  } catch (e) {
    databaseStatus = "unavailable";
    databaseError = e instanceof Error ? e.message : String(e);
  }

  const body = {
    status: databaseStatus === "ok" ? "ready" : "not_ready",
    app: env.APP_NAME,
    version: env.APP_VERSION,
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    probe: "readiness",
    checks: {
      database: databaseStatus,
      ...(databaseError ? { databaseError } : {}),
    },
  };

  if (databaseStatus === "ok") {
    return apiSuccess(body, 200);
  }
  // 503 Service Unavailable — the app is alive but NOT ready to serve traffic.
  return NextResponse.json(body, { status: 503 });
}
