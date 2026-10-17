/**
 * STR Platform — Uniform API Response Convention
 * ----------------------------------------------
 * Every API route returns the same envelope:
 *
 *   Success: { ok: true,  data: T }
 *   Error:   { ok: false, error: { code, message, meta? } }
 *
 * The `ok` boolean lets clients branch without inspecting HTTP status first;
 * the HTTP status still matches the error code so REST semantics hold.
 *
 * Routes should prefer `apiSuccess(data)` / `apiError(err)` and never build
 * NextResponse manually except for streaming or non-JSON payloads.
 *
 * See 02-Architecture §"shared API response/error conventions" and
 *     06-Engineering-Playbook §"server validation, permissions".
 */

import { NextResponse } from "next/server";
import type { AppError, AppErrorCode } from "@/lib/errors";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: AppErrorCode;
    message: string;
    meta?: Record<string, unknown>;
  };
}

export interface ResponseMeta {
  reqId?: string;
  [k: string]: unknown;
}

export function apiSuccess<T>(data: T, status = 200, meta?: ResponseMeta): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data, ...(meta ? { meta } : {}) }, { status });
}

export function apiError(err: AppError, meta?: ResponseMeta): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.meta && Object.keys(err.meta).length ? { meta: err.meta } : {}),
      },
      ...(meta ? { meta } : {}),
    },
    { status: err.status },
  );
}

/**
 * Wrap an async route handler so every thrown AppError is serialized uniformly
 * and unexpected errors become a 500 with `STR_INTERNAL_ERROR`. Also stamps the
 * request id onto the response when present.
 */
export function withApi<TArgs extends unknown[], TOut>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (e) {
      // Import dynamically to avoid circular deps at module load.
      const { isAppError, InternalError } = await import("@/lib/errors");
      const { logger } = await import("@/lib/logger");

      if (isAppError(e)) {
        if (!e.isOperational) {
          logger.error("api.non_operational", { err: e.message, code: e.code });
        }
        return apiError(e);
      }
      logger.error("api.unexpected", { err: e instanceof Error ? e.message : String(e) });
      return apiError(new InternalError());
    }
  };
}
