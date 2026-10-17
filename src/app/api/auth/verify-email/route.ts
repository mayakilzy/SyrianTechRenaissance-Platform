/**
 * STR API — Verify Email
 * POST /api/auth/verify-email
 * Body: { token }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ValidationError } from "@/lib/errors";
import { verifyEmail } from "@/modules/identity/service";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.token) throw new ValidationError("Token is required");

    const result = await verifyEmail(String(body.token));
    return apiSuccess(result);
  } catch (e) {
    if (isAppError(e)) {
      return NextResponse.json(
        { ok: false, error: { code: e.code, message: e.message } },
        { status: e.status },
      );
    }
    logger.error("api.verify.unexpected", {
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } },
      { status: 500 },
    );
  }
}
