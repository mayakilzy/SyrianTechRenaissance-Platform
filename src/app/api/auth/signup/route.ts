/**
 * STR API — Auth Signup
 * POST /api/auth/signup
 * Body: { email, password, displayName?, locale? }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ValidationError, RateLimitedError } from "@/lib/errors";
import { signup } from "@/modules/identity/service";
import { getRateLimiter } from "@/modules/identity/rate-limiter";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw new ValidationError("Invalid JSON body");

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const limiter = getRateLimiter();
    const rl = limiter.check(ip, "signup");
    if (!rl.allowed) {
      throw new RateLimitedError("Too many signup attempts. Try again later.");
    }

    const result = await signup({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      displayName: body.displayName ? String(body.displayName) : undefined,
      locale: body.locale ? String(body.locale) : undefined,
    });

    logger.info("api.signup.complete", { email: result.email });
    return apiSuccess(
      { message: result.message, status: result.status },
      201,
    );
  } catch (e) {
    if (isAppError(e)) {
      return NextResponse.json(
        { ok: false, error: { code: e.code, message: e.message } },
        { status: e.status },
      );
    }
    logger.error("api.signup.unexpected", {
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } },
      { status: 500 },
    );
  }
}
