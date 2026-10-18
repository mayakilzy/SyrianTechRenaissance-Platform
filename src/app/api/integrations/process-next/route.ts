import { NextResponse } from "next/server";
import { processNextOutboxEvent, recoverAbandonedJobs, checkTimeouts } from "@/modules/integrations/outbox-worker";

/**
 * TEST-ONLY endpoint to trigger one worker cycle.
 * Used by E2E tests to process jobs without running a separate process.
 * NOT for production use — production would run the standalone worker.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: { code: "STR_FORBIDDEN", message: "Test-only endpoint" } },
      { status: 403 },
    );
  }
  try {
    await recoverAbandonedJobs();
    await checkTimeouts();
    const hadJob = await processNextOutboxEvent();
    return NextResponse.json({ ok: true, data: { processed: hadJob } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: { code: "STR_INTERNAL_ERROR", message: e instanceof Error ? e.message : "error" } },
      { status: 500 },
    );
  }
}
