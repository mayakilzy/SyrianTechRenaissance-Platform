import { describe, it, expect } from "vitest";
import {
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitedError,
  IntegrationError,
  InternalError,
  ServiceUnavailableError,
  isAppError,
} from "@/lib/errors";

describe("STR error hierarchy", () => {
  it("every error maps to a stable HTTP status and code", () => {
    const cases = [
      [new BadRequestError("x"), 400, "STR_BAD_REQUEST"],
      [new ValidationError("x", { email: ["bad"] }), 400, "STR_VALIDATION_ERROR"],
      [new UnauthorizedError("x"), 401, "STR_UNAUTHORIZED"],
      [new ForbiddenError("x"), 403, "STR_FORBIDDEN"],
      [new NotFoundError("x"), 404, "STR_NOT_FOUND"],
      [new ConflictError("x"), 409, "STR_CONFLICT"],
      [new RateLimitedError("x"), 429, "STR_RATE_LIMITED"],
      [new IntegrationError("x"), 502, "STR_INTEGRATION_ERROR"],
      [new InternalError(), 500, "STR_INTERNAL_ERROR"],
      [new ServiceUnavailableError("x"), 503, "STR_SERVICE_UNAVAILABLE"],
    ] as const;

    for (const [err, status, code] of cases) {
      expect(err.status).toBe(status);
      expect(err.code).toBe(code);
      expect(err.message).toBeTruthy();
    }
  });

  it("ValidationError carries field-level details", () => {
    const err = new ValidationError("Invalid input", { email: ["required"], name: ["too short"] });
    expect(err.meta?.fields).toEqual({ email: ["required"], name: ["too short"] });
    const json = err.toJSON();
    expect(json.code).toBe("STR_VALIDATION_ERROR");
    expect(json.meta?.fields).toBeDefined();
  });

  it("InternalError is non-operational", () => {
    const err = new InternalError("boom");
    expect(err.isOperational).toBe(false);
  });

  it("isAppError narrows unknown to AppError", () => {
    expect(isAppError(new NotFoundError("x"))).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(isAppError("string")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
