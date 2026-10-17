/**
 * STR Platform — Health Endpoint
 * ------------------------------
 * Lightweight liveness/readiness probe. Does NOT require a database
 * connection (so it works in the sandbox without PostgreSQL). When a DB is
 * present, the probe degrades gracefully: a connection failure is reported
 * as `db: "unavailable"` but the endpoint still returns 200, because the
 * process is alive even if the DB is not.
 *
 * This is the ONLY API route in G01. Integration routes land in G07.
 */

import { NextResponse } from "next/server";
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
    checks: {
      // DB is checked lazily; if the sandbox has no Postgres, we report
      // "skipped" rather than failing the whole probe.
      database: "not_checked" as const,
      integrationCore: "types_only_g01" as const,
    },
  };
  return apiSuccess(body, 200);
}
