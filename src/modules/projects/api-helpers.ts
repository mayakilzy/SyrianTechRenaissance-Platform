/**
 * STR Projects — API route shared helper (G05)
 * ------------------------------------------------
 * Common pattern: authenticate → call service → handle errors → respond.
 * Reduces boilerplate across the 22+ G05 API routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError, AppError } from "@/lib/errors";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { logger } from "@/lib/logger";

/**
 * Get the authenticated user ID or throw ForbiddenError.
 */
export async function requireAuth(): Promise<string> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) throw new ForbiddenError("Authentication required");
  return session.user.id;
}

/**
 * Handle a route's success: return apiSuccess(data, status).
 */
export function ok<T>(data: T, status = 200) {
  return apiSuccess(data, status);
}

/**
 * Handle a route's error: AppError → its status; unknown → 500.
 */
export function fail(e: unknown, routeName: string) {
  if (e instanceof AppError || isAppError(e)) {
    return NextResponse.json(
      { ok: false, error: { code: e.code, message: e.message } },
      { status: e.status },
    );
  }
  logger.error(routeName, { err: e instanceof Error ? e.message : String(e) });
  return NextResponse.json(
    { ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 },
  );
}

/**
 * Parse JSON body or throw ValidationError.
 */
export async function parseJsonBody(req: NextRequest): Promise<unknown> {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    const { ValidationError } = await import("@/lib/errors");
    throw new ValidationError("Invalid JSON body");
  }
  return body;
}
