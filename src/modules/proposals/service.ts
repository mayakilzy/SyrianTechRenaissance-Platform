/**
 * STR Proposals — Project Proposal Service
 * ----------------------------------------
 * Implements the proposal lifecycle:
 *   DRAFT → SUBMITTED → (NEEDS_REVISION → SUBMITTED)* → APPROVED | REJECTED | WITHDRAWN
 *
 * On APPROVAL, the atomic `approveProposal()` transaction creates:
 *   - Project (exactly once per approved proposal)
 *   - Team (exactly one per project)
 *   - StewardAssignment (required, non-null)
 *   - TeamMembership for the lead (LEAD role)
 *
 * STR-GOV-TEAM-01 is enforced HERE, not just in the UI:
 *   - No direct team creation endpoint exists
 *   - The only way to create a team is through proposal approval
 *   - Approval requires a reviewer (not the submitter) and a steward
 *
 * See 03-Data-and-Permissions §invariant 2,3,4 and G03 mission.
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
// Charter schema (validation for charter revisions)
// ---------------------------------------------------------------------------

export const charterRevisionSchema = z.object({
  problemStatement: z.string().min(20, "Problem statement must be at least 20 characters").max(10000),
  outcomes: z.string().min(20, "Outcomes must be at least 20 characters").max(10000),
  scope: z.string().min(10, "Scope must be at least 10 characters").max(10000),
  exclusions: z.string().max(5000).optional(),
  beneficiaries: z.string().max(5000).optional(),
  preliminaryArchitecture: z.string().max(10000).optional(),
  requiredSkills: z.array(z.string().min(1).max(100)).min(1, "At least one required skill"),
  resources: z.string().max(5000).optional(),
  risks: z.string().max(5000).optional(),
  rights: z.string().max(5000).optional(),
  acceptanceCriteria: z.string().min(20, "Acceptance criteria must be at least 20 characters").max(10000),
});

export type CharterRevisionInput = z.infer<typeof charterRevisionSchema>;

// ---------------------------------------------------------------------------
// Create a proposal (starts in DRAFT)
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

  // Create proposal + first charter revision in a transaction.
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

    // Set as current revision
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
// Submit a proposal for review (DRAFT/NEEDS_REVISION → SUBMITTED)
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
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    }),
    db.charterRevision.update({
      where: { id: proposal.currentRevision.id },
      data: { isSubmitted: true },
    }),
  ]);

  logger.info("proposals.submitted", { proposalId, submitterId });
}

// ---------------------------------------------------------------------------
// Revise a proposal (NEEDS_REVISION → create new revision → DRAFT)
// ---------------------------------------------------------------------------

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
      data: {
        currentRevisionId: revision.id,
        status: "DRAFT",
      },
    });
  });

  logger.info("proposals.revised", { proposalId, submitterId, newVersion: lastVersion + 1 });
}

// ---------------------------------------------------------------------------
// Review a proposal (SUBMITTED → APPROVED | REJECTED | NEEDS_REVISION)
// ---------------------------------------------------------------------------

export interface ReviewInput {
  proposalId: string;
  reviewerId: string;
  action: "APPROVE" | "REJECT" | "REQUEST_REVISION";
  reason: string;
  stewardId?: string; // required for APPROVE
  leadId?: string; // required for APPROVE (defaults to submitter)
}

/**
 * Review a submitted proposal.
 *
 * CONFLICT-OF-INTEREST GUARD: the reviewer CANNOT be the submitter.
 * This is enforced in the service layer and tested.
 *
 * For APPROVE:
 *   - stewardId is required (the institutional steward)
 *   - leadId defaults to the submitter (the proposer leads their own project)
 *   - Triggers atomic team creation via approveProposal()
 *
 * For REJECT / REQUEST_REVISION:
 *   - reason is required
 *   - No team creation
 */
export async function reviewProposal(input: ReviewInput) {
  if (input.reason.trim().length < 10) {
    throw new ValidationError("Reason must be at least 10 characters");
  }

  const proposal = await db.projectProposal.findUnique({
    where: { id: input.proposalId },
    include: { currentRevision: true },
  });

  if (!proposal) throw new NotFoundError("Proposal not found");
  if (proposal.status !== "SUBMITTED") {
    throw new ConflictError(`Cannot review proposal in status ${proposal.status}`);
  }

  // CONFLICT-OF-INTEREST: reviewer cannot be the submitter.
  if (input.reviewerId === proposal.submitterId) {
    throw new ForbiddenError("Cannot review your own proposal (conflict of interest)");
  }

  // Record the review decision.
  await db.reviewDecision.create({
    data: {
      proposalId: input.proposalId,
      reviewerId: input.reviewerId,
      revisionId: proposal.currentRevisionId!,
      action: input.action,
      reason: input.reason,
      isSelfReview: false, // enforced above
    },
  });

  if (input.action === "APPROVE") {
    if (!input.stewardId) {
      throw new UnprocessableEntityError("Steward assignment is required for approval");
    }
    if (input.stewardId === proposal.submitterId) {
      throw new ForbiddenError("Steward cannot be the submitter (conflict of interest)");
    }
    await approveProposal(proposal, input.reviewerId, input.stewardId, input.leadId);
  } else if (input.action === "REJECT") {
    await db.projectProposal.update({
      where: { id: input.proposalId },
      data: { status: "REJECTED", rejectedAt: new Date() },
    });
  } else if (input.action === "REQUEST_REVISION") {
    await db.projectProposal.update({
      where: { id: input.proposalId },
      data: { status: "NEEDS_REVISION" },
    });
  }

  logger.info("proposals.reviewed", {
    proposalId: input.proposalId,
    reviewerId: input.reviewerId,
    action: input.action,
  });
}

// ---------------------------------------------------------------------------
// Atomic team creation (the heart of STR-GOV-TEAM-01)
// ---------------------------------------------------------------------------

/**
 * Atomically approve a proposal and create the project + team.
 *
 * This is the ONLY code path that creates a Team. There is no direct
 * team-creation endpoint. The transaction:
 *   1. Verifies the proposal is SUBMITTED (not already approved)
 *   2. Creates the Project (unique on proposalId — idempotent)
 *   3. Creates the Team (unique on projectId — one team per project)
 *   4. Creates the StewardAssignment (required, non-null)
 *   5. Creates the TeamMembership for the lead
 *
 * IDEMPOTENCE: if called twice for the same proposal, the second call
 * detects the existing Project and returns it without creating duplicates.
 * This is enforced by the @unique constraint on Project.proposalId.
 *
 * See 03-Data-and-Permissions §invariant 2,3,4.
 */
async function approveProposal(
  proposal: { id: string; submitterId: string; title: string; currentRevisionId: string | null },
  reviewerId: string,
  stewardId: string,
  leadId?: string,
) {
  const resolvedLeadId = leadId ?? proposal.submitterId;

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Mark proposal as approved (optimistic lock: status must be SUBMITTED).
      const updated = await tx.projectProposal.updateMany({
        where: { id: proposal.id, status: "SUBMITTED" },
        data: { status: "APPROVED", approvedAt: new Date() },
      });

      // If no row was updated, the proposal was already approved (race condition
      // or duplicate call). Check if a project already exists.
      if (updated.count === 0) {
        const existingProject = await tx.project.findUnique({
          where: { proposalId: proposal.id },
        });
        if (existingProject) {
          // Idempotent: already approved, return existing project.
          logger.info("proposals.approve.idempotent", {
            proposalId: proposal.id,
            projectId: existingProject.id,
          });
          return existingProject;
        }
        throw new ConflictError("Proposal is not in SUBMITTED status");
      }

      // 2. Create the Project (unique on proposalId).
      const project = await tx.project.create({
        data: {
          proposalId: proposal.id,
          leadId: resolvedLeadId,
          stewardId,
          title: proposal.title,
          status: "ACTIVE",
        },
      });

      // 3. Create the Team (unique on projectId).
      const team = await tx.team.create({
        data: {
          projectId: project.id,
          name: `${proposal.title} Team`,
        },
      });

      // 4. Create the StewardAssignment (required).
      await tx.stewardAssignment.create({
        data: {
          projectId: project.id,
          stewardId,
          assignedBy: reviewerId,
        },
      });

      // 5. Create the lead's TeamMembership.
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

    return result;
  } catch (e: unknown) {
    // Handle unique constraint violation (P2002) — means another concurrent
    // transaction already created the project. This is the idempotency guard.
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      const existing = await db.project.findUnique({ where: { proposalId: proposal.id } });
      if (existing) {
        logger.info("proposals.approve.race_resolved", {
          proposalId: proposal.id,
          projectId: existing.id,
        });
        return existing;
      }
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Withdraw a proposal (DRAFT/SUBMITTED/NEEDS_REVISION → WITHDRAWN)
// ---------------------------------------------------------------------------

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
// Get proposals (with authorization filtering)
// ---------------------------------------------------------------------------

export async function getProposalsForUser(userId: string) {
  return db.projectProposal.findMany({
    where: { submitterId: userId },
    include: {
      currentRevision: true,
      project: { include: { team: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProposalsForReview(reviewerId: string) {
  // Reviewers see all SUBMITTED proposals (except their own — conflict of interest).
  return db.projectProposal.findMany({
    where: {
      status: "SUBMITTED",
      submitterId: { not: reviewerId },
    },
    include: { currentRevision: true, submitter: { select: { id: true, displayName: true } } },
    orderBy: { submittedAt: "asc" },
  });
}

export async function getProposalById(proposalId: string, includeRevisions = false) {
  const proposal = await db.projectProposal.findUnique({
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
  return proposal;
}
