/**
 * STR Projects — Deliverables, Versions, Reviews & Contributions (G05)
 * ---------------------------------------------------------------------
 * Implements the versioned deliverable review workflow:
 *
 *   Deliverable: DRAFT → SUBMITTED → (IN_REVIEW) → CHANGES_REQUESTED → SUBMITTED → ...
 *                → ACCEPTED | REJECTED | WITHDRAWN
 *
 * Critical architectural constraints (per MASTER Authorization Directive):
 *
 *   1. IMMUTABILITY — DeliverableVersion rows are NEVER updated. Each
 *      resubmission creates a new row with incremented versionNumber. The
 *      previously-submitted content is preserved as audit evidence and
 *      cannot be modified after submission.
 *
 *   2. ONE REVIEW PER VERSION — A unique constraint on
 *      (deliverableId, versionNumber) prevents duplicate or conflicting
 *      reviews of the same version. If a reviewer wants to change their
 *      decision, the assignee must submit a new version.
 *
 *   3. ANTI-SELF-REVIEW — The reviewer of a deliverable cannot be the
 *      task's assignee (the submitter). Enforced at service layer.
 *
 *   4. REVIEWER = LEAD OR STEWARD — In G05, only the project lead or
 *      steward can review. Delegation to other team members is deferred to G06.
 *
 *   5. CONTRIBUTION ON ACCEPT — When a version is ACCEPTED, the system
 *      atomically creates a ContributionReference with auto-generated
 *      attribution text. The reviewer can review/edit the text before
 *      finalizing. The attribution does NOT transfer IP rights.
 *
 *   6. FILE-SCAN FAIL-CLOSED — If a DeliverableVersion references a
 *      FileEvidence, the file's scanStatus must be CLEAN before the
 *      version can be SUBMITTED or ACCEPTED. PENDING/INFECTED/SCAN_FAILED
 *      files cannot be used as evidence.
 *
 *   7. OPTIMISTIC LOCKS — Every status transition uses updateMany WHERE
 *      status=X; if count===0, throw ConflictError (concurrent transition).
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@/lib/errors";
import { z } from "zod/v4";
import { notify } from "@/modules/notifications/service";
import { loadProjectContext } from "./service";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const deliverableCreateSchema = z.object({
  taskId: z.string().min(1),
});
export type DeliverableCreateInput = z.infer<typeof deliverableCreateSchema>;

export const deliverableVersionSchema = z.object({
  textContent: z.string().max(50000).optional(),
  fileEvidenceId: z.string().optional(),
  notes: z.string().min(1).max(10000),
});
export type DeliverableVersionInput = z.infer<typeof deliverableVersionSchema>;

export const deliverableReviewSchema = z.object({
  action: z.enum(["REQUEST_CHANGES", "ACCEPT", "REJECT"]),
  reason: z.string().min(5).max(5000),
  attributionText: z.string().max(2000).optional(), // reviewer-provided override (only on ACCEPT)
});
export type DeliverableReviewInput = z.infer<typeof deliverableReviewSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify a deliverable belongs to a task the actor can see, and return the
 * project context. Throws NotFoundError if not found or not visible.
 */
async function loadDeliverableContext(deliverableId: string, actorId: string) {
  const deliverable = await db.deliverable.findUnique({
    where: { id: deliverableId },
    include: {
      task: {
        select: {
          id: true,
          projectId: true,
          assigneeId: true,
          title: true,
          project: {
            include: {
              team: { include: { memberships: { where: { leftAt: null } } } },
            },
          },
        },
      },
    },
  });
  if (!deliverable) throw new NotFoundError("Deliverable not found");

  const project = deliverable.task.project;
  const isLead = project.leadId === actorId;
  const isSteward = project.stewardId === actorId;
  const isMember =
    project.team?.memberships.some((m) => m.userId === actorId) ?? false;
  const isAssignee = deliverable.task.assigneeId === actorId;

  // Admin check
  const adminGrant = await db.roleGrant.findFirst({
    where: { userId: actorId, role: "admin", scope: "global", revokedAt: null },
  });
  const isAdmin = !!adminGrant;

  if (!isLead && !isSteward && !isMember && !isAssignee && !isAdmin) {
    // NotFound (not Forbidden) to avoid ID enumeration
    throw new NotFoundError("Deliverable not found");
  }

  return {
    deliverable,
    task: deliverable.task,
    project,
    isLead,
    isSteward,
    isMember,
    isAssignee,
    isAdmin,
  };
}

/**
 * Generate the auto-attribution text from contribution facts.
 * Format: "{contributorName} contributed to {projectTitle} on task {taskTitle} (deliverable v{version}, accepted {date})".
 * The reviewer can override this text via the review input's attributionText field.
 */
function generateAttributionText(params: {
  contributorName: string;
  projectTitle: string;
  taskTitle: string;
  versionNumber: number;
  acceptedAt: Date;
}): string {
  const dateStr = params.acceptedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  return `${params.contributorName} contributed to "${params.projectTitle}" on task "${params.taskTitle}" (deliverable v${params.versionNumber}, accepted ${dateStr}). Attribution only — no IP transfer.`;
}

// ---------------------------------------------------------------------------
// Deliverable CRUD
// ---------------------------------------------------------------------------

/**
 * Create a deliverable (DRAFT, currentVersion=0) for a task.
 * Only the task's assignee can create the deliverable.
 * Each task has at most one deliverable (enforced by unique on Task.deliverables?).
 */
export async function createDeliverable(
  taskId: string,
  actorId: string,
) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      project: {
        include: { team: { include: { memberships: { where: { leftAt: null } } } } },
      },
      deliverables: { select: { id: true } },
    },
  });
  if (!task) throw new NotFoundError("Task not found");

  // Visibility check (project participant)
  const isParticipant =
    task.project.leadId === actorId ||
    task.project.stewardId === actorId ||
    (task.project.team?.memberships.some((m) => m.userId === actorId) ?? false);
  if (!isParticipant) throw new NotFoundError("Task not found");

  // Only the assignee can create the deliverable
  if (task.assigneeId !== actorId) {
    throw new ForbiddenError("Only the task assignee can create a deliverable for it");
  }
  if (task.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${task.project.status}; cannot create deliverable`);
  }

  // Check if a deliverable already exists (one per task)
  if (task.deliverables.length > 0) {
    throw new ConflictError("A deliverable already exists for this task");
  }

  // Task must be in IN_PROGRESS or CHANGES_REQUESTED to create a deliverable
  if (!["IN_PROGRESS", "CHANGES_REQUESTED"].includes(task.status)) {
    throw new ConflictError(
      `Task is ${task.status}; can only create deliverable when IN_PROGRESS or CHANGES_REQUESTED`,
    );
  }

  const deliverable = await db.deliverable.create({
    data: {
      taskId,
      submitterId: actorId,
      status: "DRAFT",
      currentVersion: 0,
    },
  });

  logger.info("projects.deliverable.created", {
    deliverableId: deliverable.id,
    taskId,
    actorId,
  });
  return deliverable;
}

/**
 * Get a deliverable by ID (with authorization).
 * Submitter + lead + steward + team members can view.
 */
export async function getDeliverable(deliverableId: string, actorId: string) {
  const ctx = await loadDeliverableContext(deliverableId, actorId);
  return db.deliverable.findUnique({
    where: { id: deliverableId },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          projectId: true,
          assigneeId: true,
        },
      },
      submitter: { select: { id: true, displayName: true, email: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          fileEvidence: {
            select: { id: true, fileName: true, scanStatus: true, mimeType: true, sizeBytes: true },
          },
        },
      },
      reviews: {
        orderBy: { decidedAt: "desc" },
        include: {
          reviewer: { select: { id: true, displayName: true, email: true } },
        },
      },
      contribution: true,
    },
  });
}

/**
 * Submit a new version of the deliverable.
 * The version is IMMUTABLE after creation — no UPDATE path.
 * File references (if any) must have scanStatus === CLEAN.
 */
export async function submitDeliverableVersion(
  deliverableId: string,
  actorId: string,
  input: DeliverableVersionInput,
) {
  const valid = deliverableVersionSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid deliverable version data", fields);
  }
  if (!valid.data.textContent && !valid.data.fileEvidenceId) {
    throw new ValidationError("A version must have either textContent or fileEvidenceId", {
      _: ["either_textContent_or_fileEvidenceId_required"],
    });
  }

  const ctx = await loadDeliverableContext(deliverableId, actorId);
  if (!ctx.isAssignee) {
    throw new ForbiddenError("Only the task assignee can submit deliverable versions");
  }
  if (ctx.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${ctx.project.status}; cannot submit version`);
  }
  // Deliverable must be in DRAFT or CHANGES_REQUESTED to submit a new version
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(ctx.deliverable.status)) {
    throw new ConflictError(
      `Deliverable is ${ctx.deliverable.status}; can only submit version from DRAFT or CHANGES_REQUESTED`,
    );
  }

  // Verify file (if referenced) is CLEAN — fail-closed
  let fileEvidence = null;
  if (valid.data.fileEvidenceId) {
    fileEvidence = await db.fileEvidence.findUnique({
      where: { id: valid.data.fileEvidenceId },
      select: { id: true, projectId: true, scanStatus: true, uploadedById: true },
    });
    if (!fileEvidence) {
      throw new UnprocessableEntityError("Referenced file evidence not found");
    }
    // File must belong to the same project
    if (fileEvidence.projectId !== ctx.project.id) {
      throw new ForbiddenError("File evidence does not belong to this project");
    }
    // Fail-closed: only CLEAN files can be submitted as evidence
    if (fileEvidence.scanStatus !== "CLEAN") {
      throw new ConflictError(
        `File scan status is ${fileEvidence.scanStatus}; only CLEAN files can be submitted as deliverable evidence`,
      );
    }
  }

  // ATOMIC: create the version + transition deliverable + transition task — all in one transaction
  const result = await db.$transaction(async (tx) => {
    // Lock the deliverable via optimistic update — only proceed if status allows
    const nextVersion = ctx.deliverable.currentVersion + 1;
    const now = new Date();

    // Create the immutable version FIRST (within the transaction)
    const version = await tx.deliverableVersion.create({
      data: {
        deliverableId,
        versionNumber: nextVersion,
        textContent: valid.data.textContent || null,
        fileEvidenceId: valid.data.fileEvidenceId || null,
        notes: valid.data.notes,
        submittedAt: now,
      },
    });

    // Optimistic lock on deliverable status: only update if still in DRAFT/CHANGES_REQUESTED
    const updatedDeliverable = await tx.deliverable.updateMany({
      where: {
        id: deliverableId,
        status: { in: ["DRAFT", "CHANGES_REQUESTED"] },
      },
      data: {
        currentVersion: nextVersion,
        status: "SUBMITTED",
        submittedAt: ctx.deliverable.submittedAt ?? now,
        updatedAt: now,
      },
    });
    if (updatedDeliverable.count === 0) {
      throw new ConflictError(
        "Deliverable is no longer in a submittable status (concurrent transition)",
      );
    }

    // Transition the task: if it was in CHANGES_REQUESTED, move it back to SUBMITTED
    if (ctx.task) {
      await tx.task.updateMany({
        where: {
          id: ctx.task.id,
          status: { in: ["IN_PROGRESS", "CHANGES_REQUESTED"] },
        },
        data: { status: "SUBMITTED", submittedAt: now, updatedAt: now },
      });
      // If task was already in ACCEPTED state (resubmission after accept —
      // shouldn't happen because deliverable would be ACCEPTED), no-op.
    }

    return { version, nextVersion, now };
  });

  // Best-effort notification to reviewers (lead + steward)
  try {
    await notify(
      ctx.project.leadId,
      "deliverable.submitted",
      "تم استلام نسخة جديدة من مخرج / New deliverable version submitted",
      `المهمة: ${ctx.task.title} — النسخة: ${result.nextVersion}`,
    );
    if (ctx.project.stewardId !== ctx.project.leadId) {
      await notify(
        ctx.project.stewardId,
        "deliverable.submitted",
        "تم استلام نسخة جديدة من مخرج / New deliverable version submitted",
        `المهمة: ${ctx.task.title} — النسخة: ${result.nextVersion}`,
      );
    }
  } catch (e) {
    logger.warn("projects.deliverable.submitted.notification_failed", {
      deliverableId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  logger.info("projects.deliverable.version_submitted", {
    deliverableId,
    versionNumber: result.nextVersion,
    actorId,
  });
  return result.version;
}

/**
 * Review a deliverable version. Lead or steward only, NOT the submitter.
 * On ACCEPT: atomically create ContributionReference with auto-generated
 * attribution text (or reviewer-provided override).
 */
export async function reviewDeliverable(
  deliverableId: string,
  reviewerId: string,
  input: DeliverableReviewInput,
) {
  const valid = deliverableReviewSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid review data", fields);
  }

  const ctx = await loadDeliverableContext(deliverableId, reviewerId);
  // Reviewer must be lead or steward (NOT submitter)
  if (!ctx.isLead && !ctx.isSteward && !ctx.isAdmin) {
    throw new ForbiddenError("Only the project lead or steward can review deliverables");
  }
  // Anti-self-review: reviewer cannot be the task's assignee
  if (ctx.task.assigneeId === reviewerId) {
    throw new ForbiddenError("Cannot review your own deliverable (conflict of interest)");
  }
  if (ctx.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${ctx.project.status}; cannot review deliverable`);
  }
  // Deliverable must be in SUBMITTED status to review
  if (ctx.deliverable.status !== "SUBMITTED") {
    throw new ConflictError(
      `Deliverable is ${ctx.deliverable.status}; can only review SUBMITTED deliverables`,
    );
  }

  const reviewedVersion = ctx.deliverable.currentVersion;
  const now = new Date();

  // ATOMIC: create review record + transition deliverable + create contribution (on ACCEPT) + transition task
  const result = await db.$transaction(async (tx) => {
    // 1. Create the review record (the @@unique constraint on (deliverableId, versionNumber)
    //    prevents duplicate reviews of the same version)
    let review;
    try {
      review = await tx.deliverableReview.create({
        data: {
          deliverableId,
          reviewerId,
          versionNumber: reviewedVersion,
          action: valid.data.action,
          reason: valid.data.reason,
          attributionText:
            valid.data.action === "ACCEPT" ? valid.data.attributionText || null : null,
          decidedAt: now,
        },
      });
    } catch (e: unknown) {
      // Prisma unique constraint violation — a review for this version already exists
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        (e as { code?: string }).code === "P2002"
      ) {
        throw new ConflictError(
          `Version ${reviewedVersion} has already been reviewed (concurrent review)`,
        );
      }
      throw e;
    }

    // 2. Transition the deliverable status based on the review action
    let newDeliverableStatus: "ACCEPTED" | "REJECTED" | "CHANGES_REQUESTED";
    if (valid.data.action === "ACCEPT") {
      newDeliverableStatus = "ACCEPTED";
    } else if (valid.data.action === "REJECT") {
      newDeliverableStatus = "REJECTED";
    } else {
      newDeliverableStatus = "CHANGES_REQUESTED";
    }

    // Optimistic lock: only transition if still SUBMITTED
    const updated = await tx.deliverable.updateMany({
      where: { id: deliverableId, status: "SUBMITTED" },
      data: {
        status: newDeliverableStatus,
        acceptedAt: valid.data.action === "ACCEPT" ? now : null,
        updatedAt: now,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError(
        "Deliverable is no longer SUBMITTED (concurrent review or transition)",
      );
    }

    // 3. On ACCEPT: create ContributionReference (auto-generated attribution text)
    let contribution = null;
    if (valid.data.action === "ACCEPT") {
      // Load contributor info for attribution text generation
      const contributor = await tx.user.findUnique({
        where: { id: ctx.deliverable.submitterId },
        select: { id: true, displayName: true, email: true },
      });
      const contributorName = contributor?.displayName || contributor?.email || "Unknown contributor";
      const autoAttribution = generateAttributionText({
        contributorName,
        projectTitle: ctx.project.title,
        taskTitle: ctx.task.title,
        versionNumber: reviewedVersion,
        acceptedAt: now,
      });

      // Reviewer can override the attribution text
      const finalAttribution = valid.data.attributionText || autoAttribution;

      contribution = await tx.contributionReference.create({
        data: {
          deliverableId,
          projectId: ctx.project.id,
          contributorId: ctx.deliverable.submitterId,
          acceptedById: reviewerId,
          acceptedVersion: reviewedVersion,
          attributionText: finalAttribution,
        },
      });
    }

    // 4. Transition the task status based on the review
    let newTaskStatus: "ACCEPTED" | "REJECTED" | "CHANGES_REQUESTED";
    if (valid.data.action === "ACCEPT") {
      newTaskStatus = "ACCEPTED";
    } else if (valid.data.action === "REJECT") {
      newTaskStatus = "REJECTED";
    } else {
      newTaskStatus = "CHANGES_REQUESTED";
    }
    await tx.task.updateMany({
      where: { id: ctx.task.id, status: "SUBMITTED" },
      data: { status: newTaskStatus, updatedAt: now },
    });

    return { review, contribution, newDeliverableStatus, newTaskStatus };
  });

  // Best-effort notification to the submitter
  try {
    const notificationType =
      valid.data.action === "ACCEPT"
        ? "deliverable.accepted"
        : valid.data.action === "REJECT"
          ? "deliverable.rejected"
          : "deliverable.changes_requested";
    const titleAr =
      valid.data.action === "ACCEPT"
        ? "تم قبول مخرجك / Your deliverable was accepted"
        : valid.data.action === "REJECT"
          ? "تم رفض مخرجك / Your deliverable was rejected"
          : "طلب تعديلات على مخرجك / Changes requested on your deliverable";
    await notify(ctx.deliverable.submitterId, notificationType, titleAr, valid.data.reason);
  } catch (e) {
    logger.warn("projects.deliverable.reviewed.notification_failed", {
      deliverableId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  logger.info("projects.deliverable.reviewed", {
    deliverableId,
    reviewedVersion,
    action: valid.data.action,
    reviewerId,
    contributionId: result.contribution?.id,
  });

  return {
    reviewId: result.review.id,
    action: valid.data.action,
    newDeliverableStatus: result.newDeliverableStatus,
    newTaskStatus: result.newTaskStatus,
    contributionId: result.contribution?.id ?? null,
    attributionText: result.contribution?.attributionText ?? null,
  };
}

/**
 * Withdraw a deliverable. Submitter action (executor).
 * Withdraw-vs-Cancel distinction: Withdraw = executor withdraws.
 */
export async function withdrawDeliverable(deliverableId: string, actorId: string) {
  const ctx = await loadDeliverableContext(deliverableId, actorId);
  if (!ctx.isAssignee) {
    throw new ForbiddenError("Only the submitter can withdraw the deliverable");
  }
  // Cannot withdraw an already-accepted deliverable (it has a contribution reference)
  if (["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(ctx.deliverable.status)) {
    throw new ConflictError(
      `Deliverable is ${ctx.deliverable.status}; cannot withdraw`,
    );
  }

  const result = await db.deliverable.updateMany({
    where: {
      id: deliverableId,
      status: { in: ["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] },
    },
    data: { status: "WITHDRAWN", updatedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError(
      "Deliverable is no longer in a withdrawable status (concurrent transition)",
    );
  }
  logger.info("projects.deliverable.withdrawn", { deliverableId, actorId });
  return { id: deliverableId, status: "WITHDRAWN" as const };
}
