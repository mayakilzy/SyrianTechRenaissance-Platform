/**
 * STR Platform — Audit Event Helper
 * -----------------------------------
 * G09-P2 Gap 1: central helper for AuditEvent creation that:
 *   1. Populates `reqId` from the request context (AsyncLocalStorage).
 *      When no request context is available (e.g., background worker),
 *      `reqId` is null — this is correct for worker-originated operations.
 *   2. Enforces a safe `reason` field — never stores raw error messages,
 *      stack traces, or client-supplied strings that could leak secrets.
 *      Only whitelisted reason codes (Gap 2 will expand this).
 *
 * WHY: previously each of the 13 audit writes manually constructed the
 * data object, and `reqId` was never set (always null). This helper
 * ensures consistency and makes future changes (e.g., adding `outcome`
 * variants in Gap 2) a single-point edit.
 *
 * SECURITY: `actorId` is ALWAYS taken from the server-side session, never
 * from client input. `outcome` is server-determined. `reqId` is server-
 * generated (validated header or fresh UUID). No client-supplied field
 * can forge the actor or outcome.
 */
import { getRequestContext } from "@/lib/request-context";

export type AuditOutcome = "success" | "denied" | "failure";

export interface AuditDataInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: AuditOutcome;
  /**
   * Safe reason code — must be a whitelisted identifier (e.g.,
   * "insufficient_permissions", "optimistic_lock_conflict"), NOT a raw
   * error message. Gap 2 will enforce this with a validation function.
   * For Gap 1, callers pass `undefined` for success outcomes and a
   * short safe code for denied/failure.
   */
  reason?: string;
}

/**
 * Build the `data` object for `db.auditEvent.create({ data: ... })`,
 * automatically populating `reqId` from the request context.
 *
 * Usage:
 *   await tx.auditEvent.create({ data: buildAuditData({
 *     actorId, action: "provider.approve", targetType: "IntegrationProvider",
 *     targetId: providerId, outcome: "success",
 *   }) });
 */
export function buildAuditData(input: AuditDataInput) {
  return {
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    outcome: input.outcome,
    reason: input.reason ?? null,
    reqId: getRequestContext()?.reqId ?? null,
  };
}
