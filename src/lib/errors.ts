/**
 * STR Platform — Typed Error Hierarchy
 * ------------------------------------
 * Every operational error is one of a small set of typed classes, each mapping
 * to a stable HTTP status and an `AppErrorCode`. Domain code throws these; the
 * API layer catches and serializes them via `errorToResponse`.
 *
 * Never throw raw Error/strings in domain code — use these classes so error
 * semantics stay auditable and the response shape stays uniform.
 *
 * See 03-Data-and-Permissions §"Negative testing catalogue" and
 *     Engineering Playbook §"server validation, permissions".
 */

export type AppErrorCode =
  | "STR_BAD_REQUEST"
  | "STR_VALIDATION_ERROR"
  | "STR_UNAUTHORIZED"
  | "STR_FORBIDDEN"
  | "STR_NOT_FOUND"
  | "STR_CONFLICT"
  | "STR_PRECONDITION_FAILED"
  | "STR_RATE_LIMITED"
  | "STR_UNPROCESSABLE"
  | "STR_INTEGRATION_ERROR"
  | "STR_INTERNAL_ERROR"
  | "STR_SERVICE_UNAVAILABLE";

export interface AppErrorMeta {
  [key: string]: unknown;
}

export abstract class AppError extends Error {
  abstract readonly code: AppErrorCode;
  abstract readonly status: number;
  readonly meta?: AppErrorMeta;
  readonly isOperational: boolean;

  constructor(message: string, meta?: AppErrorMeta, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.meta = meta;
    this.isOperational = isOperational;
    // Preserve stack in V8
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.meta && Object.keys(this.meta).length ? { meta: this.meta } : {}),
    };
  }
}

export class BadRequestError extends AppError {
  readonly code = "STR_BAD_REQUEST" as const;
  readonly status = 400;
}

export class ValidationError extends AppError {
  readonly code = "STR_VALIDATION_ERROR" as const;
  readonly status = 400;
  constructor(
    message: string,
    readonly fields?: Record<string, string[]>,
    meta?: AppErrorMeta,
  ) {
    super(message, { ...meta, fields }, true);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = "STR_UNAUTHORIZED" as const;
  readonly status = 401;
}

export class ForbiddenError extends AppError {
  readonly code = "STR_FORBIDDEN" as const;
  readonly status = 403;
}

export class NotFoundError extends AppError {
  readonly code = "STR_NOT_FOUND" as const;
  readonly status = 404;
}

export class ConflictError extends AppError {
  readonly code = "STR_CONFLICT" as const;
  readonly status = 409;
}

export class PreconditionFailedError extends AppError {
  readonly code = "STR_PRECONDITION_FAILED" as const;
  readonly status = 412;
}

export class RateLimitedError extends AppError {
  readonly code = "STR_RATE_LIMITED" as const;
  readonly status = 429;
}

export class UnprocessableEntityError extends AppError {
  readonly code = "STR_UNPROCESSABLE" as const;
  readonly status = 422;
}

export class IntegrationError extends AppError {
  readonly code = "STR_INTEGRATION_ERROR" as const;
  readonly status = 502;
}

export class InternalError extends AppError {
  readonly code = "STR_INTERNAL_ERROR" as const;
  readonly status = 500;
  constructor(message = "Internal server error", meta?: AppErrorMeta) {
    super(message, meta, false);
  }
}

export class ServiceUnavailableError extends AppError {
  readonly code = "STR_SERVICE_UNAVAILABLE" as const;
  readonly status = 503;
}

/** Narrow a caught unknown into our AppError hierarchy. */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
