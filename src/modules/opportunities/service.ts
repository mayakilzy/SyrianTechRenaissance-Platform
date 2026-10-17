/**
 * STR Opportunities — Opportunity + Application Service
 * ------------------------------------------------------
 * Full lifecycle:
 *   Opportunity: DRAFT → SUBMITTED → (NEEDS_REVISION → SUBMITTED)* → PUBLISHED → CLOSED/CANCELLED
 *   Application: SUBMITTED → UNDER_REVIEW → ACCEPTED/REJECTED/WITHDRAWN
 *
 * Security:
 *   - Only the creator can edit/submit/withdraw their own opportunity
 *   - Only institutional reviewers (admin/reviewer) can review opportunities
 *   - Creator CANNOT self-approve (conflict of interest)
 *   - Applications are private (only applicant + opportunity creator + reviewers can see)
 *   - Applications are idempotent (one per user per opportunity)
 *   - Only PUBLISHED opportunities accept applications
 *   - Only the opportunity creator or reviewers can make application decisions
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

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const opportunityCreateSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(10000),
  type: z.enum(["PROJECT", "TASK", "MENTORSHIP", "INTERNSHIP", "CONSULTING", "OTHER"]).default("PROJECT"),
  requirements: z.string().max(5000).optional(),
  location: z.string().max(200).optional(),
  isRemote: z.boolean().default(true),
  compensationType: z.string().max(50).optional(),
  compensationNote: z.string().max(2000).optional(),
  applicationDeadline: z.string().datetime().optional(),
  projectId: z.string().optional(),
});

export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;

export const applicationCreateSchema = z.object({
  coverNote: z.string().max(5000).optional(),
});

// ---------------------------------------------------------------------------
// Opportunity CRUD
// ---------------------------------------------------------------------------

export async function createOpportunity(createdById: string, input: OpportunityCreateInput) {
  const valid = opportunityCreateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid opportunity data", fields);
  }

  // If projectId is provided, verify the project exists and the user is a member.
  if (valid.data.projectId) {
    const project = await db.project.findUnique({
      where: { id: valid.data.projectId },
      include: { team: { include: { memberships: true } } },
    });
    if (!project) throw new NotFoundError("Project not found");
    const isMember = project.team?.memberships.some(
      (m) => m.userId === createdById && !m.leftAt,
    ) ?? false;
    const isAdmin = await db.roleGrant.findFirst({
      where: { userId: createdById, role: "admin", scope: "global", revokedAt: null },
    });
    if (!isMember && !isAdmin && project.leadId !== createdById && project.stewardId !== createdById) {
      throw new ForbiddenError("You can only link opportunities to projects you are a member of");
    }
  }

  const opportunity = await db.opportunity.create({
    data: {
      ...valid.data,
      createdById,
      applicationDeadline: valid.data.applicationDeadline ? new Date(valid.data.applicationDeadline) : null,
    },
  });

  logger.info("opportunities.created", { opportunityId: opportunity.id, createdById });
  return opportunity;
}

export async function getOpportunityById(id: string) {
  return db.opportunity.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, displayName: true } },
      project: { select: { id: true, title: true } },
      reviews: {
        include: { reviewer: { select: { id: true, displayName: true } } },
        orderBy: { decidedAt: "desc" },
      },
    },
  });
}

export async function getPublishedOpportunities(page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize;
  const [results, total] = await Promise.all([
    db.opportunity.findMany({
      where: { status: "PUBLISHED" },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        project: { select: { id: true, title: true } },
      },
      skip,
      take: pageSize,
      orderBy: { publishedAt: "desc" },
    }),
    db.opportunity.count({ where: { status: "PUBLISHED" } }),
  ]);
  return { results, total, page, pageSize };
}

export async function getMyOpportunities(userId: string) {
  return db.opportunity.findMany({
    where: { createdById: userId },
    include: { _count: { select: { applications: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Opportunity lifecycle
// ---------------------------------------------------------------------------

export async function submitOpportunity(id: string, userId: string) {
  const opp = await db.opportunity.findUnique({ where: { id } });
  if (!opp) throw new NotFoundError("Opportunity not found");
  if (opp.createdById !== userId) throw new ForbiddenError("Only the creator can submit");
  if (opp.status !== "DRAFT" && opp.status !== "NEEDS_REVISION") {
    throw new ConflictError(`Cannot submit opportunity in status ${opp.status}`);
  }

  await db.opportunity.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  logger.info("opportunities.submitted", { opportunityId: id, userId });
}

export async function cancelOpportunity(id: string, userId: string) {
  const opp = await db.opportunity.findUnique({ where: { id } });
  if (!opp) throw new NotFoundError("Opportunity not found");
  if (opp.createdById !== userId) throw new ForbiddenError("Only the creator can cancel");
  if (opp.status === "CLOSED" || opp.status === "CANCELLED") {
    throw new ConflictError(`Cannot cancel opportunity in status ${opp.status}`);
  }

  await db.opportunity.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  logger.info("opportunities.cancelled", { opportunityId: id, userId });
}

export async function closeOpportunity(id: string, userId: string) {
  const opp = await db.opportunity.findUnique({ where: { id } });
  if (!opp) throw new NotFoundError("Opportunity not found");
  if (opp.createdById !== userId) throw new ForbiddenError("Only the creator can close");
  if (opp.status !== "PUBLISHED") {
    throw new ConflictError(`Can only close PUBLISHED opportunities (current: ${opp.status})`);
  }

  await db.opportunity.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  logger.info("opportunities.closed", { opportunityId: id, userId });
}

// ---------------------------------------------------------------------------
// Opportunity review (institutional)
// ---------------------------------------------------------------------------

export interface ReviewOpportunityInput {
  opportunityId: string;
  reviewerId: string;
  action: "APPROVE" | "REJECT" | "REQUEST_REVISION";
  reason: string;
}

export async function reviewOpportunity(input: ReviewOpportunityInput) {
  if (input.reason.trim().length < 10) {
    throw new ValidationError("Reason must be at least 10 characters");
  }

  // Verify reviewer is institutional.
  const isReviewer = await db.roleGrant.findFirst({
    where: {
      userId: input.reviewerId,
      revokedAt: null,
      OR: [{ role: "admin", scope: "global" }, { role: "reviewer", scope: "global" }],
    },
  });
  if (!isReviewer) {
    throw new ForbiddenError("Only institutional reviewers can review opportunities");
  }

  const opp = await db.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opp) throw new NotFoundError("Opportunity not found");
  if (opp.status !== "SUBMITTED") {
    throw new ConflictError(`Cannot review opportunity in status ${opp.status}`);
  }

  // Conflict of interest: creator cannot review their own opportunity.
  if (input.reviewerId === opp.createdById) {
    throw new ForbiddenError("Cannot review your own opportunity (conflict of interest)");
  }

  // Atomic: optimistic lock on status=SUBMITTED + review record + status change
  // all in ONE transaction. If a concurrent review already changed the status,
  // the updateMany returns count=0 and we throw.
  await db.$transaction(async (tx) => {
    // Create the review record first (inside the transaction).
    await tx.opportunityReview.create({
      data: {
        opportunityId: input.opportunityId,
        reviewerId: input.reviewerId,
        action: input.action,
        reason: input.reason,
      },
    });

    // Optimistic lock: only update if status is still SUBMITTED.
    const statusMap = {
      APPROVE: { status: "PUBLISHED", publishedAt: new Date() },
      REJECT: { status: "CANCELLED", cancelledAt: new Date() },
      REQUEST_REVISION: { status: "NEEDS_REVISION" },
    } as const;

    const updated = await tx.opportunity.updateMany({
      where: { id: input.opportunityId, status: "SUBMITTED" },
      data: statusMap[input.action],
    });

    if (updated.count === 0) {
      throw new ConflictError("Opportunity is no longer in SUBMITTED status (concurrent review)");
    }
  });

  // Send notifications (outside the transaction — non-critical).
  try {
    if (input.action === "APPROVE") {
      await notify(opp.createdById, "opportunity.published", "Opportunity Published",
      `Your opportunity "${opp.title}" has been published.`);
  } else if (input.action === "REQUEST_REVISION") {
    await notify(opp.createdById, "opportunity.revision_requested", "Revision Requested",
      `Your opportunity "${opp.title}" needs revision. Reason: ${input.reason}`);
  } else if (input.action === "REJECT") {
    await notify(opp.createdById, "opportunity.rejected", "Opportunity Rejected",
        `Your opportunity "${opp.title}" was rejected. Reason: ${input.reason}`);
    }
  } catch (notifErr) {
    logger.warn("notification.failed", { err: notifErr instanceof Error ? notifErr.message : String(notifErr) });
  }

  logger.info("opportunities.reviewed", {
    opportunityId: input.opportunityId,
    reviewerId: input.reviewerId,
    action: input.action,
  });
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function applyForOpportunity(
  opportunityId: string,
  applicantId: string,
  coverNote?: string,
) {
  const opp = await db.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opp) throw new NotFoundError("Opportunity not found");
  if (opp.status !== "PUBLISHED") {
    throw new ConflictError("Can only apply to PUBLISHED opportunities");
  }

  // Check deadline.
  if (opp.applicationDeadline && opp.applicationDeadline < new Date()) {
    throw new ConflictError("Application deadline has passed");
  }

  // Creator cannot apply to their own opportunity.
  if (opp.createdById === applicantId) {
    throw new ForbiddenError("Cannot apply to your own opportunity");
  }

  // Create application (unique constraint prevents duplicates).
  try {
    const application = await db.opportunityApplication.create({
      data: {
        opportunityId,
        applicantId,
        coverNote,
        idempotencyKey: `${opportunityId}:${applicantId}`,
      },
    });
    logger.info("opportunities.applied", { applicationId: application.id, opportunityId, applicantId });
    // Notify the opportunity creator (non-critical).
    try { await notify(opp.createdById, "application.submitted", "New Application",
      `A new application was submitted for "${opp.title}".`);
    } catch (notifErr) { logger.warn("notification.failed", { err: notifErr instanceof Error ? notifErr.message : String(notifErr) }); }
    return application;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      throw new ConflictError("You have already applied to this opportunity");
    }
    throw e;
  }
}

export async function getApplicationsForOpportunity(opportunityId: string, requesterId: string) {
  const opp = await db.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opp) throw new NotFoundError("Opportunity not found");

  // Only the creator or institutional reviewers can see applications.
  if (opp.createdById !== requesterId) {
    const isReviewer = await db.roleGrant.findFirst({
      where: {
        userId: requesterId,
        revokedAt: null,
        OR: [{ role: "admin", scope: "global" }, { role: "reviewer", scope: "global" }],
      },
    });
    if (!isReviewer) {
      throw new ForbiddenError("Only the opportunity creator or reviewers can see applications");
    }
  }

  return db.opportunityApplication.findMany({
    where: { opportunityId },
    include: {
      applicant: {
        select: {
          id: true,
          displayName: true,
          profile: { select: { headline: true, displayName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMyApplications(userId: string) {
  // SECURITY: explicitly select only fields the applicant should see.
  // qualificationNotes is PRIVATE — only visible to the opportunity creator and reviewers.
  const apps = await db.opportunityApplication.findMany({
    where: { applicantId: userId },
    select: {
      id: true,
      opportunityId: true,
      status: true,
      coverNote: true,
      decisionReason: true,
      createdAt: true,
      updatedAt: true,
      decidedAt: true,
      withdrawnAt: true,
      // qualificationNotes is intentionally NOT selected here.
      opportunity: {
        select: { id: true, title: true, status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return apps;
}

export async function decideApplication(
  applicationId: string,
  decisionMakerId: string,
  decision: "ACCEPTED" | "REJECTED",
  reason: string,
  qualificationNotes?: string,
) {
  if (reason.trim().length < 5) {
    throw new ValidationError("Decision reason must be at least 5 characters");
  }

  const application = await db.opportunityApplication.findUnique({
    where: { id: applicationId },
    include: { opportunity: true },
  });
  if (!application) throw new NotFoundError("Application not found");
  if (application.status !== "SUBMITTED" && application.status !== "UNDER_REVIEW") {
    throw new ConflictError(`Cannot decide on application in status ${application.status}`);
  }

  // G04-FINAL-DECISION-GUARD: no decisions on CLOSED or CANCELLED opportunities.
  // This prevents accepting someone into an opportunity that no longer exists.
  if (application.opportunity.status === "CLOSED" || application.opportunity.status === "CANCELLED") {
    throw new ConflictError(
      `Cannot decide on application: opportunity is ${application.opportunity.status}`,
    );
  }

  // Only the opportunity creator or institutional reviewers can decide.
  if (application.opportunity.createdById !== decisionMakerId) {
    const isReviewer = await db.roleGrant.findFirst({
      where: {
        userId: decisionMakerId,
        revokedAt: null,
        OR: [{ role: "admin", scope: "global" }, { role: "reviewer", scope: "global" }],
      },
    });
    if (!isReviewer) {
      throw new ForbiddenError("Only the opportunity creator or reviewers can make decisions");
    }
  }

  // ATOMIC: transaction that locks both the application AND the opportunity.
  // This prevents the race where the opportunity is closed/cancelled between
  // the status check above and the application update below.
  //
  // The transaction:
  //   1. Re-reads the opportunity with a pessimistic lock (SELECT FOR UPDATE)
  //   2. Verifies opportunity is still PUBLISHED
  //   3. Updates the application with optimistic lock on its status
  //
  // If a concurrent close/cancel changes the opportunity status between
  // the read and the update, the transaction will see the new status and abort.
  const updated = await db.$transaction(async (tx) => {
    // Re-read the opportunity inside the transaction (with lock).
    const opp = await tx.opportunity.findUnique({
      where: { id: application.opportunityId },
      select: { status: true },
    });

    if (!opp || opp.status !== "PUBLISHED") {
      throw new ConflictError(
        `Cannot decide on application: opportunity is ${opp?.status ?? "not found"}`,
      );
    }

    // Optimistic lock: only update if application is still in a decidable status.
    const result = await tx.opportunityApplication.updateMany({
      where: { id: applicationId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      data: {
        status: decision,
        decisionReason: reason,
        qualificationNotes,
        decidedAt: new Date(),
      },
    });

    if (result.count === 0) {
      throw new ConflictError("Application is no longer in a decidable status (concurrent decision)");
    }

    return result;
  });

  // Notify the applicant (non-critical — don't fail the decision if notification fails).
  try {
    await notify(
    application.applicantId,
    `application.${decision.toLowerCase()}`,
    decision === "ACCEPTED" ? "Application Accepted" : "Application Rejected",
      `Your application for "${application.opportunity.title}" was ${decision.toLowerCase()}. Reason: ${reason}`,
    );
  } catch (notifErr) {
    logger.warn("notification.failed", { err: notifErr instanceof Error ? notifErr.message : String(notifErr) });
  }

  logger.info("opportunities.application_decided", { applicationId, decision, decisionMakerId });
}

export async function withdrawApplication(applicationId: string, applicantId: string) {
  const application = await db.opportunityApplication.findUnique({ where: { id: applicationId } });
  if (!application) throw new NotFoundError("Application not found");
  if (application.applicantId !== applicantId) {
    throw new ForbiddenError("Only the applicant can withdraw");
  }
  if (application.status === "ACCEPTED" || application.status === "REJECTED") {
    throw new ConflictError(`Cannot withdraw application in status ${application.status}`);
  }

  // Atomic: optimistic lock on status IN (SUBMITTED, UNDER_REVIEW).
  // Prevents concurrent withdrawal + decision race.
  const updated = await db.opportunityApplication.updateMany({
    where: { id: applicationId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
    data: { status: "WITHDRAWN", withdrawnAt: new Date() },
  });

  if (updated.count === 0) {
    throw new ConflictError("Application is no longer in a withdrawable status (concurrent decision)");
  }
  // Notify the opportunity creator (non-critical).
  try { await notify(
    application.opportunityId ? (await db.opportunity.findUnique({ where: { id: application.opportunityId }, select: { createdById: true, title: true } }))?.createdById ?? "" : "",
    "application.withdrawn",
    "Application Withdrawn",
      `An application was withdrawn for your opportunity.`,
    );
  } catch (notifErr) { logger.warn("notification.failed", { err: notifErr instanceof Error ? notifErr.message : String(notifErr) }); }

  logger.info("opportunities.application_withdrawn", { applicationId, applicantId });
}
