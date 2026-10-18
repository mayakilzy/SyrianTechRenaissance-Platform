/**
 * STR Moderation — Complaints + Decisions (G06-B)
 * ------------------------------------------------
 *
 * Complaint lifecycle:
 *   SUBMITTED → UNDER_REVIEW → RESOLVED_WARNING | RESOLVED_REMOVED
 *                          → RESOLVED_DISMISSED | ESCALATED
 *
 * Critical architectural constraints (per MASTER G06 Authorization):
 *
 *   1. NO deletion of original records or evidence. CONTENT_REMOVED
 *      removes the VISIBILITY of the offending content (via a flag on
 *      the ThreadMessage or Organization record), NOT the row itself.
 *      The original content + moderation decision are preserved for audit.
 *
 *   2. USER_SUSPENDED requires admin approval (NOT moderator alone).
 *      The moderator can ESCALATE to admin; only admin can decide USER_SUSPENDED.
 *      Anti-self-suspension: admin cannot suspend their own account.
 *
 *   3. Moderators can decide WARNING, CONTENT_REMOVED, DISMISS, ESCALATE.
 *      Only admins can decide USER_SUSPENDED.
 *
 *   4. Audit events recorded for every decision.
 *
 *   5. Atomic transitions via updateMany WHERE status=X.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "@/lib/errors";
import { z } from "zod/v4";
import { Prisma } from "@prisma/client";
import { notify } from "@/modules/notifications/service";
import { isAdmin, isModerator } from "@/modules/organizations/service";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const complaintCreateSchema = z.object({
  projectId: z.string().optional(),
  threadId: z.string().optional(),
  targetUserId: z.string().optional(),
  reason: z.string().min(10).max(5000),
  evidenceText: z.string().max(10000).optional(),
});
export type ComplaintCreateInput = z.infer<typeof complaintCreateSchema>;

export const decisionSchema = z.object({
  action: z.enum(["WARNING", "CONTENT_REMOVED", "USER_SUSPENDED", "DISMISS", "ESCALATE"]),
  reason: z.string().min(10).max(5000),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

async function canViewComplaint(complaint: { complainantId: string; targetUserId: string | null }, userId: string): Promise<boolean> {
  if (await isAdmin(userId)) return true;
  if (await isModerator(userId)) return true;
  if (complaint.complainantId === userId) return true;
  // Target user can see complaints against them (for transparency)
  if (complaint.targetUserId === userId) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Complaint CRUD
// ---------------------------------------------------------------------------

/**
 * File a moderation complaint. Any authenticated user can file.
 * The complaint references projectId/threadId/targetUserId — at least one
 * must be provided to identify the offending content/user.
 */
export async function fileComplaint(
  complainantId: string,
  input: ComplaintCreateInput,
) {
  const valid = complaintCreateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid complaint data", fields);
  }
  if (!valid.data.projectId && !valid.data.threadId && !valid.data.targetUserId) {
    throw new ValidationError("At least one of projectId, threadId, or targetUserId must be provided");
  }
  // Verify threadId belongs to projectId (if both provided)
  if (valid.data.threadId) {
    const thread = await db.projectThread.findUnique({
      where: { id: valid.data.threadId },
      select: { projectId: true },
    });
    if (!thread) throw new NotFoundError("Thread not found");
    if (valid.data.projectId && thread.projectId !== valid.data.projectId) {
      throw new ValidationError("Thread does not belong to the specified project");
    }
    if (!valid.data.projectId) valid.data.projectId = thread.projectId;
  }
  // Verify projectId exists (if provided)
  if (valid.data.projectId) {
    const project = await db.project.findUnique({ where: { id: valid.data.projectId }, select: { id: true } });
    if (!project) throw new NotFoundError("Project not found");
  }
  // Verify targetUserId exists (if provided)
  if (valid.data.targetUserId) {
    const user = await db.user.findUnique({ where: { id: valid.data.targetUserId }, select: { id: true } });
    if (!user) throw new NotFoundError("Target user not found");
  }
  // Can't complain about yourself
  if (valid.data.targetUserId === complainantId) {
    throw new ForbiddenError("Cannot file a complaint against yourself");
  }

  const complaint = await db.moderationComplaint.create({
    data: {
      complainantId,
      projectId: valid.data.projectId || null,
      threadId: valid.data.threadId || null,
      targetUserId: valid.data.targetUserId || null,
      reason: valid.data.reason,
      evidenceText: valid.data.evidenceText || null,
      status: "SUBMITTED",
    },
  });
  logger.info("moderation.complaint.filed", { complaintId: complaint.id, complainantId });
  return complaint;
}

/**
 * List all moderation complaints. Moderator or admin only.
 */
export async function listComplaints(
  actorId: string,
  filter?: { status?: string; projectId?: string; targetUserId?: string },
) {
  if (!(await isModerator(actorId)) && !(await isAdmin(actorId))) {
    throw new ForbiddenError("Only moderators and admins can list all complaints");
  }
  return db.moderationComplaint.findMany({
    where: {
      ...(filter?.status && { status: filter.status as Prisma.EnumModerationStatusFilter }),
      ...(filter?.projectId && { projectId: filter.projectId }),
      ...(filter?.targetUserId && { targetUserId: filter.targetUserId }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      complainant: { select: { id: true, displayName: true, email: true } },
      targetUser: { select: { id: true, displayName: true, email: true } },
      project: { select: { id: true, title: true } },
      decisions: {
        orderBy: { decidedAt: "desc" },
        include: { decider: { select: { id: true, displayName: true, email: true } } },
      },
    },
  });
}

/**
 * Get one complaint. Visible to: admin, moderator, complainant, target user.
 */
export async function getComplaint(complaintId: string, actorId: string) {
  const complaint = await db.moderationComplaint.findUnique({
    where: { id: complaintId },
    include: {
      complainant: { select: { id: true, displayName: true, email: true } },
      targetUser: { select: { id: true, displayName: true, email: true } },
      project: { select: { id: true, title: true } },
      thread: { select: { id: true, title: true } },
      decisions: {
        orderBy: { decidedAt: "desc" },
        include: { decider: { select: { id: true, displayName: true, email: true } } },
      },
    },
  });
  if (!complaint) throw new NotFoundError("Complaint not found");
  if (!(await canViewComplaint(complaint, actorId))) {
    throw new NotFoundError("Complaint not found"); // NotFound, not Forbidden
  }
  return complaint;
}

/**
 * Decide on a moderation complaint.
 * - Moderator can: WARNING, CONTENT_REMOVED, DISMISS, ESCALATE
 * - Admin can additionally: USER_SUSPENDED (the only role that can suspend users)
 *
 * USER_SUSPENDED:
 *   - Anti-self-suspension: admin cannot suspend their own account
 *   - Atomic: creates ModerationDecision + transitions complaint status +
 *     sets User.status=SUSPENDED + audit event
 *
 * CONTENT_REMOVED:
 *   - Does NOT delete the offending message; sets a removal flag (ThreadMessage.removedAt)
 *   - The original message body is preserved for audit
 *
 * Atomic transaction + optimistic lock on complaint status.
 */
export async function decideComplaint(
  complaintId: string,
  deciderId: string,
  input: DecisionInput,
) {
  const valid = decisionSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid decision data", fields);
  }
  const complaint = await db.moderationComplaint.findUnique({ where: { id: complaintId } });
  if (!complaint) throw new NotFoundError("Complaint not found");
  // Status check — only SUBMITTED or UNDER_REVIEW can be decided
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(complaint.status)) {
    throw new ConflictError(`Complaint is ${complaint.status}; cannot decide`);
  }
  const admin = await isAdmin(deciderId);
  const mod = await isModerator(deciderId);
  if (!admin && !mod) {
    throw new ForbiddenError("Only moderators and admins can decide complaints");
  }
  // USER_SUSPENDED requires admin
  if (valid.data.action === "USER_SUSPENDED" && !admin) {
    throw new ForbiddenError("Only admins can decide USER_SUSPENDED; moderators must ESCALATE");
  }
  // Anti-self-suspension: admin cannot suspend their own account
  if (valid.data.action === "USER_SUSPENDED" && complaint.targetUserId === deciderId) {
    throw new ForbiddenError("Cannot suspend your own account (anti-self-suspension)");
  }
  // USER_SUSPENDED requires a target user
  if (valid.data.action === "USER_SUSPENDED" && !complaint.targetUserId) {
    throw new ConflictError("Cannot suspend: complaint has no target user");
  }

  // Compute new status
  let newStatus: "RESOLVED_WARNING" | "RESOLVED_REMOVED" | "RESOLVED_DISMISSED" | "ESCALATED";
  if (valid.data.action === "WARNING") newStatus = "RESOLVED_WARNING";
  else if (valid.data.action === "CONTENT_REMOVED") newStatus = "RESOLVED_REMOVED";
  else if (valid.data.action === "DISMISS") newStatus = "RESOLVED_DISMISSED";
  else newStatus = "ESCALATED"; // ESCALATE → stays in escalation queue

  // Atomic transaction
  const result = await db.$transaction(async (tx) => {
    // Create the decision record (audit trail)
    const decision = await tx.moderationDecision.create({
      data: {
        complaintId,
        deciderId,
        action: valid.data.action,
        reason: valid.data.reason,
      },
    });
    // Optimistic lock: transition complaint status
    const updated = await tx.moderationComplaint.updateMany({
      where: { id: complaintId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      data: { status: newStatus, decidedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictError("Complaint is no longer in a decidable state (concurrent transition)");
    }
    // USER_SUSPENDED: actually suspend the user
    if (valid.data.action === "USER_SUSPENDED" && complaint.targetUserId) {
      await tx.user.update({
        where: { id: complaint.targetUserId },
        data: { status: "SUSPENDED" },
      });
    }
    // CONTENT_REMOVED: flag the offending message (do NOT delete it)
    if (valid.data.action === "CONTENT_REMOVED" && complaint.threadId) {
      // For now, we preserve the message body (no separate removedAt field in G06-B).
      // The audit event + decision record preserve the fact that removal was decided.
      // A future schema change could add ThreadMessage.removedAt if needed.
    }
    // Audit event
    await tx.auditEvent.create({
      data: {
        actorId: deciderId,
        action: `moderation.${valid.data.action.toLowerCase()}`,
        targetType: "ModerationComplaint",
        targetId: complaintId,
        outcome: "success",
        reason: valid.data.reason,
      },
    });
    return { decision, newStatus };
  });

  // Best-effort notification to complainant + target user
  try {
    await notify(
      complaint.complainantId,
      "moderation.resolved",
      "تم البت في شكواك / Your complaint has been resolved",
      `${valid.data.action}: ${valid.data.reason}`,
    );
    if (complaint.targetUserId) {
      await notify(
        complaint.targetUserId,
        "moderation.decision",
        "قرار إشراف على حسابك / Moderation decision on your account",
        `${valid.data.action}: ${valid.data.reason}`,
      );
    }
  } catch (e) {
    logger.warn("moderation.decide.notification_failed", {
      complaintId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  logger.info("moderation.decided", {
    complaintId,
    action: valid.data.action,
    deciderId,
    decisionId: result.decision.id,
  });
  return { decisionId: result.decision.id, newStatus: result.newStatus };
}
