/**
 * STR API — Request Password Reset
 * POST /api/auth/reset-password
 * Body: { email }
 * Returns: generic message (enumeration defense)
 */

import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ValidationError, RateLimitedError } from "@/lib/errors";
import { requestPasswordReset } from "@/modules/identity/service";
import { getRateLimiter } from "@/modules/identity/rate-limiter";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.email) throw new ValidationError("Email is required");

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const limiter = getRateLimiter();
    const rl = limiter.check(ip, "reset");
    if (!rl.allowed) {
      throw new RateLimitedError("Too many reset attempts. Try again later.");
    }

    const result = await requestPasswordReset({ email: String(body.email) });
    return apiSuccess({ message: result.message });
  } catch (e) {
    if (isAppError(e)) {
      return NextResponse.json(
        { ok: false, error: { code: e.code, message: e.message } },
        { status: e.status },
      );
    }
    logger.error("api.reset.unexpected", {
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } },
      { status: 500 },
    );
  }
}
