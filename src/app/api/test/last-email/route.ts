import { NextResponse } from "next/server";
import { getCaptureEmailService } from "@/modules/identity/email-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // DEBUG: log the env value to see what the route sees in CI
  const testMode = process.env.STR_TEST_MODE;
  // eslint-disable-next-line no-console
  console.log("[DEBUG /api/test/last-email] STR_TEST_MODE =", JSON.stringify(testMode), "NODE_ENV =", JSON.stringify(process.env.NODE_ENV));

  if (testMode !== "1") {
    return NextResponse.json(
      { ok: false, error: { code: "STR_NOT_FOUND", message: "Not found", debug: { testMode } } },
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
