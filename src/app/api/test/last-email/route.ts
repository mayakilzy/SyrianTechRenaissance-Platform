/**
 * STR API — Test-only: Last Email
 * GET /api/test/last-email?to=<email>
 *
 * ONLY available when NODE_ENV=test. Returns the last email "sent" to the
 * given address by the CaptureEmailService. Used by Playwright E2E tests
 * to extract verification/reset tokens without real email delivery.
 *
 * In any other environment, this endpoint returns 404. It can NEVER expose
 * emails in production because it doesn't exist outside the test build.
 */

import { NextResponse } from "next/server";
import { getCaptureEmailService } from "@/modules/identity/email-service";

export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "test") {
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

  const emailService = getCaptureEmailService();
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
      textBody: email.textBody,
    },
  });
}
