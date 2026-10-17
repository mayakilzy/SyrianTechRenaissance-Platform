/**
 * STR API — Test-only: Last Email (TEST BUILD ONLY)
 * -------------------------------------------------
 * GET /api/test/last-email?to=<email>
 *
 * ⚠️  SECURITY: This endpoint exposes email content (including verification
 * and password-reset tokens) and MUST NEVER be reachable in any deployment
 * except an isolated test/CI build.
 *
 * Protection layers:
 *   1. Runtime: Returns 404 unless STR_TEST_MODE env var is "1".
 *      This env var is set ONLY by the Playwright CI e2e job (see
 *      .github/workflows/ci.yml). It is never set in production, staging,
 *      or local dev.
 *   2. Build: Excluded from production standalone output trace via
 *      `outputFileTracingExcludes` in next.config.ts.
 *   3. CI verification: security-negative.spec.ts asserts no email content
 *      leaks when the route is unreachable.
 *
 * We use STR_TEST_MODE instead of NODE_ENV because Next.js's `next dev`
 * forces NODE_ENV=development, overriding any NODE_ENV=test we set.
 *
 * See G02-RECOVERY §5 (test route hardening).
 */

import { NextResponse } from "next/server";
import { getCaptureEmailService } from "@/modules/identity/email-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (process.env.STR_TEST_MODE !== "1") {
    return NextResponse.json(
      { ok: false, error: { code: "STR_NOT_FOUND", message: "Not found" } },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  if (!to) {
    return NextResponse.json(
      { ok: false, error: { code: "STR_BAD_REQUEST", message: "Missing 'to' parameter" } },
      { status: 400 },
    );
  }

  let emailService;
  try {
    emailService = getCaptureEmailService();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "STR_NOT_FOUND", message: "Not found" } },
      { status: 404 },
    );
  }

  const email = emailService.lastTo(to);
  if (!email) {
    return NextResponse.json(
      { ok: false, error: { code: "STR_NOT_FOUND", message: "No email found" } },
      { status: 404 },
    );
  }

  const urlMatch = email.textBody.match(/https?:\/\/[^\s]+token=[^\s&]+/);
  const tokenUrl = urlMatch?.[0];

  return NextResponse.json({
    ok: true,
    data: {
      to: email.to,
      subject: email.subject,
      type: email.metadata?.type,
      tokenUrl,
      textBody: email.textBody,
    },
  });
}
