/**
 * STR Proposals — Project Proposal Service (G03-FIX)
 * ----------------------------------------------------
 * Implements the proposal lifecycle with INSTITUTIONAL AUTHORIZATION:
 *
 *   DRAFT → SUBMITTED → (NEEDS_REVISION → SUBMITTED)* → APPROVED | REJECTED | WITHDRAWN
 *
 * G03-FIX security fixes:
 *   1. Only institutional reviewers can approve/reject/revise (not any member)
 *   2. Steward must be pre-qualified (has admin role or explicit steward grant)
 *      — no self-appointment via a user ID in the request
 *   3. suspendProject/reactivateProject enforce authorization INSIDE the service
 *   4. ReviewDecision is created INSIDE the approval transaction (atomic)
 *
 * STR-GOV-TEAM-01 enforced at DB + service + API layers.
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

// ---------------------------------------------------------------------------
// Charter schema
// ---------------------------------------------------------------------------

export const charterRevisionSchema = z.object({
  problemStatement: z.string().min(20).max(10000),
  outcomes: z.string().min(20).max(10000),
  scope: z.string().min(10).max(10000),
  exclusions: z.string().max(5000).optional(),
  beneficiaries: z.string().max(5000).optional(),
  preliminaryArchitecture: z.string().max(10000).optional(),
  requiredSkills: z.array(z.string().min(1).max(100)).min(1),
  resources: z.string().max(5000).optional(),
  risks: z.string().max(5000).optional(),
  rights: z.string().max(5000).optional(),
  acceptanceCriteria: z.string().min(20).max(10000),
});

export type CharterRevisionInput = z.infer<typeof charterRevisionSchema>;

// ---------------------------------------------------------------------------
// Institutional authorization helpers (G03-FIX §1, §2)
// ---------------------------------------------------------------------------

/**
 * Check if a user is an institutional reviewer.
 * In G03, reviewers are users with the "admin" global role OR an explicit
 * "reviewer" role grant. This is the G03 baseline; G06 may add a more
 * nuanced reviewer policy.
 *
 * CRITICAL: this is checked in the SERVICE layer, not just the API route,
 * so even if a future caller forgets the check, the service blocks it.
 */
async function isInstitutionalReviewer(userId: string): Promise<boolean> {
  const grant = await db.roleGrant.findFirst({
    where: {
      userId,
      revokedAt: null,
      OR: [
        { role: "admin", scope: "global" },
        { role: "reviewer", scope: "global" },
      ],
    },
  });
  return !!grant;
}

/**
 * Check if a user is qualified to be a steward.
 * In G03, stewards are users with the "admin" global role OR an explicit
 * "steward" role grant. This prevents arbitrary self-appointment: a member
 * cannot propose a stewardId that points to themselves or to another
 * unqualified member.
 *
 * The reviewer must STILL pass this check for the steward they nominate.
 */
async function isQualifiedSteward(userId: string): Promise<boolean> {
  const grant = await db.roleGrant.findFirst({
    where: {
      userId,
      revokedAt: null,
      OR: [
        { role: "admin", scope: "global" },
        { role: "steward", scope: "global" },
      ],
    },
  });
  return !!grant;
}

// ---------------------------------------------------------------------------
// Create a proposal (DRAFT)
// ---------------------------------------------------------------------------

export interface CreateProposalInput {
  submitterId: string;
  title: string;
  charter: CharterRevisionInput;
}

export async function createProposal(input: CreateProposalInput) {
  const valid = charterRevisionSchema.safeParse(input.charter);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid charter data", fields);
  }
  if (input.title.trim().length < 5) {
    throw new ValidationError("Title must be at least 5 characters");
  }

  const proposal = await db.$transaction(async (tx) => {
    const prop = await tx.projectProposal.create({
      data: {
        submitterId: input.submitterId,
        title: input.title.trim(),
        status: "DRAFT",
      },
    });
    const revision = await tx.charterRevision.create({
      data: {
        proposalId: prop.id,
        version: 1,
        createdBy: input.submitterId,
        isSubmitted: false,
        ...valid.data,
        requiredSkills: valid.data.requiredSkills,
      },
    });
    await tx.projectProposal.update({
      where: { id: prop.id },
      data: { currentRevisionId: revision.id },
    });
    return prop;
  });

  logger.info("proposals.created", { proposalId: proposal.id, submitterId: input.submitterId });
  return proposal;
}

// ---------------------------------------------------------------------------
// Submit / Revise / Withdraw (unchanged from G03, but kept for completeness)
// ---------------------------------------------------------------------------

export async function submitProposal(proposalId: string, submitterId: string) {
  const proposal = await db.projectProposal.findUnique({
    where: { id: proposalId },
    include: { currentRevision: true },
  });
  if (!proposal) throw new NotFoundError("Proposal not found");
  if (proposal.submitterId !== submitterId) {
    throw new ForbiddenError("Only the submitter can submit this proposal");
  }
  if (proposal.status !== "DRAFT" && proposal.status !== "NEEDS_REVISION") {
    throw new ConflictError(`Cannot submit proposal in status ${proposal.status}`);
  }
  if (!proposal.currentRevision) {
    throw new UnprocessableEntityError("Proposal has no charter revision");
  }
  await db.$transaction([
    db.projectProposal.update({
      where: { id: proposalId },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    }),
    db.charterRevision.update({
      where: { id: proposal.currentRevision.id },
      data: { isSubmitted: true },
    }),
  ]);
  logger.info("proposals.submitted", { proposalId, submitterId });
}

export async function reviseProposal(
  proposalId: string,
  submitterId: string,
  charter: CharterRevisionInput,
) {
  const valid = charterRevisionSchema.safeParse(charter);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid charter data", fields);
  }
  const proposal = await db.projectProposal.findUnique({
    where: { id: proposalId },
    include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!proposal) throw new NotFoundError("Proposal not found");
  if (proposal.submitterId !== submitterId) {
    throw new ForbiddenError("Only the submitter can revise this proposal");
  }
  if (proposal.status !== "NEEDS_REVISION" && proposal.status !== "DRAFT") {
    throw new ConflictError(`Cannot revise proposal in status ${proposal.status}`);
  }
  const lastVersion = proposal.revisions[0]?.version ?? 0;
  await db.$transaction(async (tx) => {
    const revision = await tx.charterRevision.create({
      data: {
        proposalId,
        version: lastVersion + 1,
        createdBy: submitterId,
        isSubmitted: false,
        ...valid.data,
        requiredSkills: valid.data.requiredSkills,
      },
    });
    await tx.projectProposal.update({
      where: { id: proposalId },
      data: { currentRevisionId: revision.id, status: "DRAFT" },
    });
  });
  logger.info("proposals.revised", { proposalId, submitterId, newVersion: lastVersion + 1 });
}

export async function withdrawProposal(proposalId: string, submitterId: string) {
  const proposal = await db.projectProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw new NotFoundError("Proposal not found");
  if (proposal.submitterId !== submitterId) {
    throw new ForbiddenError("Only the submitter can withdraw this proposal");
  }
  if (proposal.status === "APPROVED" || proposal.status === "REJECTED") {
    throw new ConflictError(`Cannot withdraw proposal in status ${proposal.status}`);
  }
  await db.projectProposal.update({
    where: { id: proposalId },
    data: { status: "WITHDRAWN", withdrawnAt: new Date() },
  });
  logger.info("proposals.withdrawn", { proposalId, submitterId });
}

// ---------------------------------------------------------------------------
// Review a proposal (G03-FIX: institutional authorization + atomicity)
// ---------------------------------------------------------------------------

export interface ReviewInput {
  proposalId: string;
  reviewerId: string;
  action: "APPROVE" | "REJECT" | "REQUEST_REVISION";
  reason: string;
  stewardId?: string;
  leadId?: string;
}

/**
 * Review a submitted proposal.
 *
 * G03-FIX SECURITY:
 *   1. reviewerId must be an institutional reviewer (admin or reviewer role)
 *   2. For APPROVE: stewardId must be a qualified steward (admin or steward role)
 *   3. Neither reviewer nor steward can be the submitter (conflict of interest)
 *   4. ReviewDecision is created INSIDE the approval transaction (atomic)
 *
 * If approval fails (e.g., race condition), NO ReviewDecision is recorded.
 * Rejected/revision requests are recorded in their own transactions.
 */
export async function reviewProposal(input: ReviewInput) {
  if (input.reason.trim().length < 10) {
    throw new ValidationError("Reason must be at least 10 characters");
  }

  // ── G03-FIX §1: Verify reviewer is an institutional reviewer ──
  const isReviewer = await isInstitutionalReviewer(input.reviewerId);
  if (!isReviewer) {
    throw new ForbiddenError("Only institutional reviewers can review proposals");
  }

  const proposal = await db.projectProposal.findUnique({
    where: { id: input.proposalId },
    include: { currentRevision: true },
  });
  if (!proposal) throw new NotFoundError("Proposal not found");
  if (proposal.status !== "SUBMITTED") {
    throw new ConflictError(`Cannot review proposal in status ${proposal.status}`);
  }

  // ── Conflict of interest: reviewer cannot be the submitter ──
  if (input.reviewerId === proposal.submitterId) {
    throw new ForbiddenError("Cannot review your own proposal (conflict of interest)");
  }

  // ── G03-FIX §2: For APPROVE, verify steward is qualified ──
  if (input.action === "APPROVE") {
    if (!input.stewardId) {
      throw new UnprocessableEntityError("Steward assignment is required for approval");
    }
    if (input.stewardId === proposal.submitterId) {
      throw new ForbiddenError("Steward cannot be the submitter (conflict of interest)");
    }
    if (input.stewardId === input.reviewerId) {
      throw new ForbiddenError("Steward cannot be the reviewer (separation of duties)");
    }
    const stewardQualified = await isQualifiedSteward(input.stewardId);
    if (!stewardQualified) {
      throw new ForbiddenError("Proposed steward is not qualified (requires admin or steward role)");
    }
  }

  // ── Execute the action ──
  if (input.action === "APPROVE") {
    // G03-FIX §4: atomic — ReviewDecision + status change + Project + Team +
    // StewardAssignment + TeamMembership all in ONE transaction.
    await approveProposalAtomically(proposal, input);
  } else if (input.action === "REJECT") {
    // Reject: record decision + update status in one transaction.
    if (!proposal.currentRevisionId) {
      throw new UnprocessableEntityError("Proposal has no current revision");
    }
    await db.$transaction(async (tx) => {
      await tx.reviewDecision.create({
        data: {
          proposalId: input.proposalId,
          reviewerId: input.reviewerId,
          revisionId: proposal.currentRevisionId!,
          action: "REJECT",
          reason: input.reason,
          isSelfReview: false,
        },
      });
      await tx.projectProposal.update({
        where: { id: input.proposalId },
        data: { status: "REJECTED", rejectedAt: new Date() },
      });
    });
  } else if (input.action === "REQUEST_REVISION") {
    // Request revision: record decision + update status.
    if (!proposal.currentRevisionId) {
      throw new UnprocessableEntityError("Proposal has no current revision");
    }
    await db.$transaction(async (tx) => {
      await tx.reviewDecision.create({
        data: {
          proposalId: input.proposalId,
          reviewerId: input.reviewerId,
          revisionId: proposal.currentRevisionId!,
          action: "REQUEST_REVISION",
          reason: input.reason,
          isSelfReview: false,
        },
      });
      await tx.projectProposal.update({
        where: { id: input.proposalId },
        data: { status: "NEEDS_REVISION" },
      });
    });
  }

  logger.info("proposals.reviewed", {
    proposalId: input.proposalId,
    reviewerId: input.reviewerId,
    action: input.action,
  });
}

// ---------------------------------------------------------------------------
// Atomic approval (G03-FIX §4: everything in ONE transaction)
// ---------------------------------------------------------------------------

/**
 * Atomically approve a proposal:
 *   1. ReviewDecision (APPROVE) is recorded
 *   2. Proposal status → APPROVED
 *   3. Project is created (unique on proposalId — idempotent)
 *   4. Team is created (unique on projectId)
 *   5. StewardAssignment is created
 *   6. TeamMembership (LEAD) is created
 *
 * ALL in a single db.$transaction. If ANY step fails, the ENTIRE transaction
 * rolls back — no partial state, no orphaned ReviewDecision.
 *
 * Idempotency: if a concurrent transaction already approved this proposal,
 * the optimistic lock (updateMany WHERE status=SUBMITTED) returns count=0,
 * and we check for an existing project. If found, we return it without
 * creating duplicates.
 */
async function approveProposalAtomically(
  proposal: { id: string; submitterId: string; title: string; currentRevisionId: string | null },
  input: ReviewInput,
) {
  const resolvedLeadId = input.leadId ?? proposal.submitterId;
  const stewardId = input.stewardId!;

  try {
    await db.$transaction(async (tx) => {
      // 1. Optimistic lock: mark proposal APPROVED only if still SUBMITTED.
      const updated = await tx.projectProposal.updateMany({
        where: { id: proposal.id, status: "SUBMITTED" },
        data: { status: "APPROVED", approvedAt: new Date() },
      });

      if (updated.count === 0) {
        // Race condition: another transaction already approved this.
        const existing = await tx.project.findUnique({ where: { proposalId: proposal.id } });
        if (existing) {
          logger.info("proposals.approve.idempotent", { proposalId: proposal.id, projectId: existing.id });
          return existing;
        }
        throw new ConflictError("Proposal is not in SUBMITTED status");
      }

      // 2. Record the ReviewDecision (NOW inside the transaction).
      await tx.reviewDecision.create({
        data: {
          proposalId: proposal.id,
          reviewerId: input.reviewerId,
          revisionId: proposal.currentRevisionId!,
          action: "APPROVE",
          reason: input.reason,
          isSelfReview: false,
        },
      });

      // 3. Create the Project (unique on proposalId).
      const project = await tx.project.create({
        data: {
          proposalId: proposal.id,
          leadId: resolvedLeadId,
          stewardId,
          title: proposal.title,
          status: "ACTIVE",
        },
      });

      // 4. Create the Team (unique on projectId).
      const team = await tx.team.create({
        data: {
          projectId: project.id,
          name: `${proposal.title} Team`,
        },
      });

      // 5. Create the StewardAssignment.
      await tx.stewardAssignment.create({
        data: {
          projectId: project.id,
          stewardId,
          assignedBy: input.reviewerId,
        },
      });

      // 6. Create the lead's TeamMembership.
      await tx.teamMembership.create({
        data: {
          teamId: team.id,
          userId: resolvedLeadId,
          role: "LEAD",
        },
      });

      logger.info("proposals.approved.atomic", {
        proposalId: proposal.id,
        projectId: project.id,
        teamId: team.id,
        leadId: resolvedLeadId,
        stewardId,
      });
      return project;
    });
  } catch (e: unknown) {
    // Handle unique constraint violation (P2002) — concurrent approval.
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      const existing = await db.project.findUnique({ where: { proposalId: proposal.id } });
      if (existing) {
        logger.info("proposals.approve.race_resolved", { proposalId: proposal.id, projectId: existing.id });
        return existing;
      }
    }
    throw e;
  }
}


// ---------------------------------------------------------------------------
// Scope change after approval (G03-FINAL §3)
// ---------------------------------------------------------------------------

/**
 * Request a scope change for an APPROVED project.
 * Creates a new CharterRevision and sets the proposal status to NEEDS_REVISION.
 * The approved charter remains immutable; the new revision must be re-approved
 * before it takes effect.
 *
 * Only the project lead or the steward can request a scope change.
 */
export async function requestScopeChange(
  proposalId: string,
  actorId: string,
  charter: CharterRevisionInput,
  reason: string,
): Promise<void> {
  const valid = charterRevisionSchema.safeParse(charter);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid charter data", fields);
  }
  if (reason.trim().length < 10) {
    throw new ValidationError("Scope change reason must be at least 10 characters");
  }

  const proposal = await db.projectProposal.findUnique({
    where: { id: proposalId },
    include: {
      project: true,
      revisions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!proposal) throw new NotFoundError("Proposal not found");
  if (proposal.status !== "APPROVED") {
    throw new ConflictError("Scope changes can only be requested for approved projects");
  }
  if (!proposal.project) {
    throw new UnprocessableEntityError("No project found for this proposal");
  }

  // Only the lead or steward can request a scope change.
  const isLead = proposal.project.leadId === actorId;
  const isSteward = proposal.project.stewardId === actorId;
  const isAdmin = await db.roleGrant.findFirst({
    where: { userId: actorId, role: "admin", scope: "global", revokedAt: null },
  });
  if (!isLead && !isSteward && !isAdmin) {
    throw new ForbiddenError("Only the lead, steward, or admin can request a scope change");
  }

  const lastVersion = proposal.revisions[0]?.version ?? 0;

  await db.$transaction(async (tx) => {
    const revision = await tx.charterRevision.create({
      data: {
        proposalId,
        version: lastVersion + 1,
        createdBy: actorId,
        isSubmitted: true,
        ...valid.data,
        requiredSkills: valid.data.requiredSkills,
      },
    });

    // Set the proposal to NEEDS_REVISION — the scope change must be re-approved.
    await tx.projectProposal.update({
      where: { id: proposalId },
      data: {
        currentRevisionId: revision.id,
        status: "NEEDS_REVISION",
      },
    });

    // Record the scope change request as a review decision (for audit).
    await tx.reviewDecision.create({
      data: {
        proposalId,
        reviewerId: actorId,
        revisionId: revision.id,
        action: "REQUEST_REVISION",
        reason: `Scope change requested: ${reason}`,
        isSelfReview: false,
      },
    });
  });

  logger.info("proposals.scope_change_requested", { proposalId, actorId, reason });
}

// ---------------------------------------------------------------------------
// Get proposals
// ---------------------------------------------------------------------------

export async function getProposalsForUser(userId: string) {
  return db.projectProposal.findMany({
    where: { submitterId: userId },
    include: { currentRevision: true, project: { include: { team: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProposalsForReview(reviewerId: string) {
  return db.projectProposal.findMany({
    where: { status: "SUBMITTED", submitterId: { not: reviewerId } },
    include: { currentRevision: true, submitter: { select: { id: true, displayName: true } } },
    orderBy: { submittedAt: "asc" },
  });
}

export async function getProposalById(proposalId: string, includeRevisions = false) {
  return db.projectProposal.findUnique({
    where: { id: proposalId },
    include: {
      currentRevision: true,
      submitter: { select: { id: true, displayName: true } },
      reviewDecisions: {
        include: { reviewer: { select: { id: true, displayName: true } } },
        orderBy: { decidedAt: "desc" },
      },
      project: {
        include: {
          team: { include: { memberships: { include: { user: { select: { id: true, displayName: true } } } } } },
          steward: { select: { id: true, displayName: true } },
          lead: { select: { id: true, displayName: true } },
        },
      },
      ...(includeRevisions ? { revisions: { orderBy: { version: "asc" } } } : {}),
    },
  });
}
