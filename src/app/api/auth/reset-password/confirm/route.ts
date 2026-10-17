/**
 * STR API — Confirm Password Reset
 * POST /api/auth/reset-password/confirm
 * Body: { token, newPassword }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ValidationError, RateLimitedError } from "@/lib/errors";
import { confirmPasswordReset } from "@/modules/identity/service";
import { getRateLimiter } from "@/modules/identity/rate-limiter";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.token || !body?.newPassword) {
      throw new ValidationError("Token and new password are required");
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const limiter = getRateLimiter();
    const rl = limiter.check(ip, "reset_confirm");
    if (!rl.allowed) {
      throw new RateLimitedError("Too many attempts. Try again later.");
    }

    const result = await confirmPasswordReset({
      token: String(body.token),
      newPassword: String(body.newPassword),
    });
    return apiSuccess(result);
  } catch (e) {
    if (isAppError(e)) {
      return NextResponse.json(
        { ok: false, error: { code: e.code, message: e.message } },
        { status: e.status },
      );
    }
    logger.error("api.reset_confirm.unexpected", {
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } },
      { status: 500 },
    );
  }
}
