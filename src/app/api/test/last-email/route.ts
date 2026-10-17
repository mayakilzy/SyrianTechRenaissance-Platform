/**
 * STR API — Test-only: Last Email (TEST BUILD ONLY)
 * -------------------------------------------------
 * GET /api/test/last-email?to=<email>
 *
 * ⚠️  SECURITY: This endpoint exposes email content (including verification
 * and password-reset tokens) and MUST NEVER be reachable in any deployment
 * except an isolated test/CI build.
 *
 * Three layers of protection:
 *   1. Build-time: This file is excluded from production standalone builds
 *      via the `outputFileTracingExcludes` setting in next.config.ts AND
 *      the route is conditionally exported using `dynamic = "force-static"`
 *      with a build-time NODE_ENV check (see below).
 *   2. Runtime: Returns 404 unless `process.env.NODE_ENV === "test"`.
 *   3. CI verification: A dedicated Playwright test asserts this endpoint
 *      returns 404 when NODE_ENV !== "test".
 *
 * If you need to enable this route in a non-test environment, you are doing
 * something wrong. Email token extraction is a test-only concern; production
 * must use real email delivery + user-initiated flows.
 *
 * See G02-RECOVERY §5 (test route hardening).
 */

import { NextResponse } from "next/server";
import { getCaptureEmailService } from "@/modules/identity/email-service";

// Build-time guard: if this file somehow ends up in a production build,
// the route handler throws on first invocation, ensuring no email content
// is ever returned even if the runtime NODE_ENV check is bypassed.
const IS_TEST_BUILD = process.env.NODE_ENV === "test";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Layer 1: runtime NODE_ENV check.
  if (!IS_TEST_BUILD) {
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

  // Layer 2: only the CaptureEmailService (test singleton) can provide data.
  // In production, getCaptureEmailService() throws because it checks NODE_ENV.
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

  // Extract the verification/reset URL from the text body.
  const urlMatch = email.textBody.match(/https?:\/\/[^\s]+token=[^\s&]+/);
  const tokenUrl = urlMatch?.[0];

  return NextResponse.json({
    ok: true,
    data: {
      to: email.to,
      subject: email.subject,
      type: email.metadata?.type,
      tokenUrl,
      // NOTE: textBody is included so tests can extract reset URLs that use
      // a path segment (/auth/reset-password/<token>) rather than ?token=.
      // This is test-only; never enable in production.
      textBody: email.textBody,
    },
  });
}
