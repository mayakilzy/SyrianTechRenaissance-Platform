/**
 * STR Platform — Audit Denied/Failure Helper (Gap 2)
 * ----------------------------------------------------
 * Writes denied/failure audit events OUTSIDE any rolled-back transaction.
 *
 * CRITICAL DESIGN (denied-audit-trap):
 *   If we write outcome="denied" INSIDE the same transaction that gets
 *   rolled back (e.g., because the optimistic-lock check failed), the
 *   audit record is LOST when the transaction rolls back. This defeats
 *   the purpose of auditing denied attempts.
 *
 *   Solution: denied/failure audits are written in a SEPARATE db.auditEvent.create
 *   call AFTER the original transaction throws. This call commits independently
 *   of the failed operation.
 *
 * SECURITY (per ChatGPT review):
 *   1. `denied` = authorization failure (ForbiddenError thrown BEFORE any
 *      state change). Always written for high-risk governance operations
 *      when a non-admin attempts them.
 *   2. `failure` = operational failure (ConflictError from optimistic lock,
 *      NotFoundError, ValidationError). NOT written for every ConflictError —
 *      only for governance operations where the failure itself is
 *      security-relevant (e.g., repeated denied attempts = probing pattern).
 *   3. NO raw error messages stored. Reason is a SAFE CODE from a whitelist.
 *   4. NO stack traces or secrets stored.
 *   5. Actor identity comes from the server-side session, never client input.
 *   6. Outcome is server-determined (denied vs failure), never client-supplied.
 *   7. No leakage of hidden entity existence: denied audit records the
 *      targetId only when the actor already knew it (e.g., they sent a
 *      request with the id). For unauthorized reads, we use targetId=null
 *      to avoid confirming the entity exists.
 *
 * FAILURE POLICY (per ChatGPT point #3):
 *   If the DB is down and the denied/failure audit write itself fails,
 *   we cannot let that block the original operation's error response.
 *   The denied-audit write is wrapped in a catch that:
 *     - Logs loudly (logger.error) so monitoring/alerting can detect it.
 *     - Does NOT mask the original error (it's re-thrown).
 *     - Does NOT retry (would amplify load during DB outage).
 *   This is a documented limitation: during a total DB outage, denied
 *   attempts may not be audited. Monitoring must detect the logger.error
 *   spike and alert. This is the trade-off for not blocking the original
 *   operation's error response.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildAuditData, type AuditOutcome } from "@/lib/audit";
import { getRequestContext } from "@/lib/request-context";
import type { AppError } from "@/lib/errors";

/**
 * Whitelisted reason codes for denied/failure audits.
 * These are SAFE to store — no raw error messages, no PII, no secrets.
 *
 * Add new codes here when adding denied-audit to new operations.
 * The code MUST be a short snake_case identifier, NOT a free-form string.
 */
const AUDIT_REASON_CODES = [
  // Authorization denials
  "insufficient_permissions", // non-admin attempted admin-only operation
  "not_owner", // user attempted operation on resource they don't own
  "not_team_member", // user attempted operation on project they're not part of
  "conflict_of_interest", // user attempted to review/approve own resource
  // Operational failures (security-relevant only)
  "optimistic_lock_conflict", // concurrent transition — state changed mid-operation
  "invalid_state_transition", // entity not in expected state for this operation
  "not_found", // target entity doesn't exist (or actor lacks permission to see it)
  "validation_error", // input validation failed (security-relevant for probing detection)
] as const;

export type AuditReasonCode = (typeof AUDIT_REASON_CODES)[number];

/**
 * Map an AppError to a safe reason code + outcome.
 * Returns null if the error type is NOT security-relevant (shouldn't be audited).
 *
 * Per ChatGPT directive: "لا تحول كل ConflictError إلى حادثة أمنية" —
 * ConflictError is only audited when it's from a governance operation
 * (the caller decides by invoking this function). Regular ConflictErrors
 * from normal operations (e.g., duplicate submission) are NOT audited.
 */
export function classifyErrorForAudit(
  e: unknown,
): { outcome: AuditOutcome; reason: AuditReasonCode } | null {
  // Check if it's an AppError with a code property
  if (!e || typeof e !== "object" || !("code" in e)) {
    // Unknown error type — don't audit (could leak internals)
    return null;
  }
  const appErr = e as AppError;
  // ForbiddenError → denied (authorization failure)
  if (appErr.code === "STR_FORBIDDEN") {
    // Inspect the message to determine the specific reason code.
    // This is safe because we control the messages in the service layer.
    const msg = appErr.message.toLowerCase();
    if (msg.includes("conflict of interest") || msg.includes("cannot review your own")) {
      return { outcome: "denied", reason: "conflict_of_interest" };
    }
    if (msg.includes("not owner") || msg.includes("only the submitter")) {
      return { outcome: "denied", reason: "not_owner" };
    }
    if (msg.includes("not team member") || msg.includes("not a participant")) {
      return { outcome: "denied", reason: "not_team_member" };
    }
    // Default forbidden → insufficient_permissions
    return { outcome: "denied", reason: "insufficient_permissions" };
  }
  // ConflictError → failure (operational, security-relevant for governance)
  if (appErr.code === "STR_CONFLICT") {
    const msg = appErr.message.toLowerCase();
    if (msg.includes("concurrent transition") || msg.includes("not in") && msg.includes("status")) {
      return { outcome: "failure", reason: "optimistic_lock_conflict" };
    }
    if (msg.includes("already") && (msg.includes("approved") || msg.includes("verified") || msg.includes("revoked"))) {
      return { outcome: "failure", reason: "invalid_state_transition" };
    }
    // Other conflicts (e.g., duplicate submission) — not security-relevant
    return null;
  }
  // NotFoundError → failure (entity doesn't exist OR actor lacks permission)
  // Per ChatGPT: "لا تكشف وجود كيان مخفي" — we use targetId=null in the
  // audit write for NotFoundError to avoid confirming the entity exists.
  if (appErr.code === "STR_NOT_FOUND") {
    return { outcome: "failure", reason: "not_found" };
  }
  // ValidationError → failure (input validation)
  if (appErr.code === "STR_VALIDATION_ERROR") {
    return { outcome: "failure", reason: "validation_error" };
  }
  // Other error types (internal errors, etc.) — don't audit
  return null;
}

/**
 * Write a denied/failure audit event OUTSIDE any transaction.
 *
 * This is the denied-audit-trap solution: the original operation's
 * transaction has already rolled back (or was never started for auth
 * failures). This call commits independently.
 *
 * SECURITY:
 *   - actorId is passed by the caller (always from server session)
 *   - action is the operation name (e.g., "provider.approve")
 *   - targetType is the entity type
 *   - targetId is the entity id (pass null for NotFoundError to avoid
 *     confirming entity existence)
 *   - outcome + reason come from classifyErrorForAudit()
 *
 * FAILURE POLICY:
 *   If this audit write itself fails (DB down), we:
 *     - Log loudly via logger.error (monitoring detects the spike)
 *     - Do NOT mask the original error (caller re-throws)
 *     - Do NOT retry (would amplify load)
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
  } catch (auditErr) {
    // DOCUMENTED LIMITATION: during DB outage, denied/failure audits may
    // be lost. We log loudly so monitoring can detect the spike and alert.
    // We do NOT mask the original error — the caller re-throws it.
    // We do NOT retry — would amplify load during outage.
    const reqId = getRequestContext()?.reqId ?? "no-req-id";
    logger.error("audit.denied_failure.write_failed", {
      reqId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      outcome: params.outcome,
      reason: params.reason,
      auditError: auditErr instanceof Error ? auditErr.message : String(auditErr),
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
 *         targetType: "IntegrationProvider", targetId: providerId,
 *         hideTargetIdOnNotFound: false },
 *       async () => {
 *         // ... existing approveProvider logic (including the $transaction) ...
 *       },
 *     );
 *   }
 *
 * The wrapper:
 *   1. Runs the operation.
 *   2. If it throws, classifies the error.
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
      // For NotFoundError with hideTargetIdOnNotFound, use null to avoid
      // confirming entity existence.
      const targetIdForAudit =
        classified.reason === "not_found" && params.hideTargetIdOnNotFound
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
    // Re-throw the original error (do not mask it)
    throw e;
  }
}
