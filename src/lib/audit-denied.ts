/**
 * STR Platform — Audit Denied/Failure Helper (Gap 2, revised)
 * ----------------------------------------------------
 * Writes denied/failure audit events OUTSIDE any rolled-back transaction.
 *
 * REVISION HISTORY (per ChatGPT review):
 *   v1 (original): classified errors by msg.includes("not owner") — fragile.
 *                  Logged auditErr.message — risk of leaking DB internals.
 *   v2 (current):  classification by stable code + explicit meta.auditReason.
 *                  Safe diagnostic code in logs (no raw error messages).
 *
 * CRITICAL DESIGN (denied-audit-trap):
 *   If we write outcome="denied" INSIDE the same transaction that gets
 *   rolled back, the audit record is LOST. Solution: denied/failure
 *   audits are written in a SEPARATE db.auditEvent.create call AFTER
 *   the original transaction throws. This call commits independently.
 *
 * CLASSIFICATION (FIX 2 — per ChatGPT point #2):
 *   v1 used e.message.includes("not owner") — fragile (changing the
 *   message wording would silently change the audit classification).
 *   v2 uses TWO sources, in priority order:
 *     1. meta.auditReason — explicit stable code set by the service
 *        layer when throwing the error. This is the PREFERRED source:
 *        the service knows the operational context and sets the code.
 *     2. AppError.code — stable enum (STR_FORBIDDEN, STR_CONFLICT, etc.).
 *        Used as a fallback when meta.auditReason is not set. Maps to
 *        a generic reason code (insufficient_permissions for FORBIDDEN,
 *        optimistic_lock_conflict for CONFLICT, etc.).
 *   NO message-text matching. The message is for humans; the code is
 *   for machines.
 *
 * CONFLICT/NOTFOUND POLICY (FIX 3 — per ChatGPT point #3):
 *   - ForbiddenError → always audited as "denied" (authorization failure
 *     is security-relevant: probing attacks).
 *   - ConflictError → audited as "failure" ONLY when meta.auditReason is
 *     set by the service (explicit opt-in). Regular ConflictErrors (e.g.,
 *     duplicate submission) are NOT audited — they're operational, not
 *     security-relevant.
 *   - NotFoundError → audited as "failure" ONLY when meta.auditReason is
 *     set. Regular NotFoundErrors (e.g., user mistypes a URL) are NOT
 *     audited — they're noise.
 *   - ValidationError → NOT audited by default (input validation failures
 *     are operational noise, not security events). Service can opt in via
 *     meta.auditReason if validation failure indicates probing.
 *
 * LOG SAFETY (FIX 1 — per ChatGPT point #1):
 *   If the denied-audit write itself fails, we log a SAFE diagnostic:
 *     - A stable error code ("audit_write_failed")
 *     - The reqId (for correlation with other logs)
 *     - The action/targetType/targetId (already known to the caller)
 *     - The intended outcome/reason (the safe code we were trying to write)
 *   We do NOT log auditErr.message (may contain DB internals, connection
 *   strings, or stack traces). The raw error is discarded after the
 *   safe code is extracted; detailed diagnostics require separate
 *   infrastructure (error reporter, not logger).
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildAuditData, type AuditOutcome } from "@/lib/audit";
import { getRequestContext } from "@/lib/request-context";
import type { AppError, AppErrorCode } from "@/lib/errors";

/**
 * Whitelisted reason codes for denied/failure audits.
 * These are SAFE to store — no raw error messages, no PII, no secrets.
 */
const AUDIT_REASON_CODES = [
  // Authorization denials (ForbiddenError)
  "insufficient_permissions",
  "not_owner",
  "not_team_member",
  "conflict_of_interest",
  // Operational failures (ConflictError/NotFoundError — only when opted in)
  "optimistic_lock_conflict",
  "invalid_state_transition",
  "entity_not_found",
  "validation_failed_probing",
] as const;

export type AuditReasonCode = (typeof AUDIT_REASON_CODES)[number];

/**
 * Stable mapping from AppError.code to a generic AuditReasonCode.
 * Used as a FALLBACK when meta.auditReason is not explicitly set.
 *
 * NOTE: only ForbiddenError is mapped by default (authorization failures
 * are always security-relevant). ConflictError/NotFoundError/ValidationError
 * are NOT mapped here — they require explicit meta.auditReason opt-in
 * from the service layer (per ChatGPT point #3).
 */
const CODE_FALLBACK: Partial<Record<AppErrorCode, AuditReasonCode>> = {
  STR_FORBIDDEN: "insufficient_permissions",
};

/**
 * Classify an error for denied/failure audit.
 *
 * Returns null if the error is NOT security-relevant (shouldn't be audited).
 *
 * Classification priority:
 *   1. meta.auditReason — explicit stable code from the service layer.
 *      This is the PREFERRED source: the service knows the operational
 *      context (e.g., "this ConflictError is from an optimistic-lock check
 *      on a governance operation, which IS security-relevant").
 *   2. CODE_FALLBACK[code] — generic mapping for ForbiddenError only.
 *
 * NO message-text matching. The message is for humans; the code is for
 * machines.
 */
export function classifyErrorForAudit(
  e: unknown,
): { outcome: AuditOutcome; reason: AuditReasonCode } | null {
  if (!e || typeof e !== "object" || !("code" in e)) {
    return null;
  }
  const appErr = e as AppError;

  // Source 1: explicit meta.auditReason (preferred — set by service layer)
  const explicitReason = (appErr.meta as { auditReason?: unknown } | undefined)?.auditReason;
  if (typeof explicitReason === "string" && AUDIT_REASON_CODES.includes(explicitReason as AuditReasonCode)) {
    // Determine outcome from the error code:
    // - ForbiddenError → denied
    // - ConflictError/NotFoundError/ValidationError → failure
    const outcome: AuditOutcome =
      appErr.code === "STR_FORBIDDEN" ? "denied" : "failure";
    return { outcome, reason: explicitReason as AuditReasonCode };
  }

  // Source 2: fallback mapping (ForbiddenError only)
  const fallbackReason = CODE_FALLBACK[appErr.code];
  if (fallbackReason) {
    return { outcome: "denied", reason: fallbackReason };
  }

  // ConflictError / NotFoundError / ValidationError WITHOUT explicit
  // meta.auditReason → NOT audited (per ChatGPT point #3: don't turn
  // every operational error into a security incident).
  return null;
}

/**
 * Stable diagnostic code for the logger when the denied-audit write fails.
 * This is the ONLY thing logged — no raw error message.
 */
const AUDIT_WRITE_FAILED_CODE = "audit_write_failed";

/**
 * Write a denied/failure audit event OUTSIDE any transaction.
 *
 * SECURITY:
 *   - actorId is passed by the caller (always from server session)
 *   - action is the operation name (e.g., "provider.approve")
 *   - targetType is the entity type
 *   - targetId is the entity id (null for hidden-entity protection)
 *   - outcome + reason come from classifyErrorForAudit()
 *
 * FAILURE POLICY (FIX 1 — per ChatGPT point #1):
 *   If this audit write itself fails (DB down, constraint violation, etc.),
 *   we log a SAFE diagnostic:
 *     - stable code: "audit_write_failed"
 *     - reqId (for correlation)
 *     - the action/targetType/targetId we were trying to audit
 *     - the intended outcome/reason (the safe code)
 *   We do NOT log auditErr.message (may contain DB internals).
 *   We do NOT mask the original error (caller re-throws).
 *   We do NOT retry (would amplify load during DB outage).
 */
export async function writeDeniedFailureAudit(params: {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: AuditOutcome;
  reason: AuditReasonCode;
}): Promise<void> {
  try {
    await db.auditEvent.create({
      data: buildAuditData({
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        outcome: params.outcome,
        reason: params.reason, // safe code, not raw message
      }),
    });
  } catch {
    // FIX 1: log ONLY safe diagnostic fields. Do NOT log the raw error
    // message (auditErr.message may contain DB internals, connection
    // strings, or stack traces). Detailed diagnostics require separate
    // infrastructure (error reporter), not the logger.
    const reqId = getRequestContext()?.reqId ?? "no-req-id";
    logger.error("audit.denied_failure.write_failed", {
      // Stable diagnostic code — safe to log
      diagnosticCode: AUDIT_WRITE_FAILED_CODE,
      // Correlation id — safe to log
      reqId,
      // The audit we were trying to write — all safe fields
      intendedAction: params.action,
      intendedTargetType: params.targetType,
      intendedTargetId: params.targetId,
      intendedOutcome: params.outcome,
      intendedReason: params.reason,
      // NOTE: auditErr.message is intentionally NOT logged here.
      // If detailed diagnostics are needed, a separate error-reporting
      // channel (not the logger) should be used, with its own access
      // controls and retention policy.
    });
  }
}

/**
 * Wrap a governance operation with denied/failure audit.
 *
 * Usage:
 *   export async function approveProvider(providerId, approverId) {
 *     return withDeniedFailureAudit(
 *       { actorId: approverId, action: "provider.approve",
 *         targetType: "IntegrationProvider", targetId: providerId },
 *       async () => { ... existing logic ... },
 *     );
 *   }
 *
 * The wrapper:
 *   1. Runs the operation.
 *   2. If it throws, classifies the error (by meta.auditReason or code).
 *   3. If the error is security-relevant (denied/failure), writes an audit
 *      event OUTSIDE the operation's transaction.
 *   4. Re-throws the original error.
 *
 * hideTargetIdOnNotFound: when true, sets targetId=null for NotFoundError
 *   to avoid confirming the entity exists (per ChatGPT point #6).
 */
export async function withDeniedFailureAudit<T>(
  params: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    hideTargetIdOnNotFound?: boolean;
  },
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    const classified = classifyErrorForAudit(e);
    if (classified) {
      const targetIdForAudit =
        classified.reason === "entity_not_found" && params.hideTargetIdOnNotFound
          ? null
          : params.targetId;

      await writeDeniedFailureAudit({
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType,
        targetId: targetIdForAudit,
        outcome: classified.outcome,
        reason: classified.reason,
      });
    }
    throw e;
  }
}
