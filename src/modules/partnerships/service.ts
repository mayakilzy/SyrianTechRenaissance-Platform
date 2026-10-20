/**
 * STR Partnerships — Partnership Requests, Decisions, Agreements, and
 * Contribution Rights Declarations (G06-A)
 * ----------------------------------------------------------------
 *
 * PartnershipRequest: SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | WITHDRAWN
 *
 * Critical architectural constraints (per MASTER G06 Authorization):
 *
 *   1. ONLY a verified rep of an org can submit a partnership request.
 *      Requester must be isVerifiedRepresentative(org).
 *
 *   2. Anti-self-decision: decider cannot be the requester.
 *      deciderId !== requesterId (conflict of interest).
 *
 *   3. Decider must be partnership_manager or admin (NOT moderator).
 *
 *   4. Agreement references are EVIDENCE, NOT legally-binding contracts.
 *      The system NEVER generates contract text. Signed PDFs are uploaded
 *      as evidence; their scanStatus enforces fail-closed read URLs.
 *
 *   5. If an agreement is later marked INFECTED (after partnership was
 *      APPROVED), operational reliance is suspended (agreementSuspendedAt
 *      set), but the historical decision is preserved. NO automatic legal
 *      cancellation of the partnership.
 *
 *   6. Contribution Rights Declarations are OPTIONAL — a contribution can
 *      exist without one. The declaration is a CLAIM requiring context +
 *      evidence; it does NOT auto-transfer IP. WORK_FOR_HIRE and
 *      LICENSE_GRANTED are declarative statements by the contributor, NOT
 *      legal facts the system proves.
 *
 *   7. Atomic transitions via updateMany WHERE status=X (optimistic lock).
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildAuditData } from "@/lib/audit";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@/lib/errors";
import { z } from "zod/v4";
import { Prisma } from "@prisma/client";
import { notify } from "@/modules/notifications/service";
import { isVerifiedRepresentative, isAdmin, isPartnershipManager } from "@/modules/organizations/service";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const partnershipRequestSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().optional(),
  proposalText: z.string().min(50).max(10000),
});
export type PartnershipRequestInput = z.infer<typeof partnershipRequestSchema>;

export const partnershipDecisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "REQUEST_REVISION"]),
  reason: z.string().min(10).max(5000),
});
export type PartnershipDecisionInput = z.infer<typeof partnershipDecisionSchema>;

export const agreementUploadSchema = z.object({
  storageKey: z.string().min(1).max(500),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
});
export type AgreementUploadInput = z.infer<typeof agreementUploadSchema>;

export const rightsDeclarationSchema = z.object({
  declarationType: z.enum(["LICENSE_GRANTED", "ATTRIBUTION_ONLY", "WORK_FOR_HIRE", "OTHER"]),
  declarationText: z.string().min(20).max(10000),
  evidenceStorageKey: z.string().max(500).optional(),
});
export type RightsDeclarationInput = z.infer<typeof rightsDeclarationSchema>;

// ---------------------------------------------------------------------------
// Partnership Request CRUD
// ---------------------------------------------------------------------------

/**
 * Submit a partnership request.
 * Requester must be a verified rep of the organization.
 * Organization must be ACTIVE.
 */
export async function submitPartnershipRequest(
  requesterId: string,
  input: PartnershipRequestInput,
) {
  const valid = partnershipRequestSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid partnership request data", fields);
  }
  // Verify the requester is a verified rep of an ACTIVE org
  const org = await db.organization.findUnique({
    where: { id: valid.data.organizationId },
    select: { id: true, status: true, displayName: true },
  });
  if (!org) throw new NotFoundError("Organization not found");
  if (org.status !== "ACTIVE") {
    throw new ConflictError(`Organization is ${org.status}; cannot submit partnership request`);
  }
  const isRep = await isVerifiedRepresentative(requesterId, valid.data.organizationId);
  if (!isRep) {
    throw new ForbiddenError(
      "Only a verified representative of the organization can submit a partnership request",
    );
  }
  // If projectId provided, verify it exists and the requester is a participant
  if (valid.data.projectId) {
    const project = await db.project.findUnique({
      where: { id: valid.data.projectId },
      include: {
        team: { include: { memberships: { where: { leftAt: null } } } },
      },
    });
    if (!project) throw new NotFoundError("Project not found");
    // Requester must be project participant OR admin
    const admin = await isAdmin(requesterId);
    const isParticipant =
      project.leadId === requesterId ||
      project.stewardId === requesterId ||
      (project.team?.memberships.some((m) => m.userId === requesterId) ?? false);
    if (!isParticipant && !admin) {
      throw new ForbiddenError("Requester must be a participant of the project");
    }
  }

  const request = await db.partnershipRequest.create({
    data: {
      requesterId,
      organizationId: valid.data.organizationId,
      projectId: valid.data.projectId || null,
      proposalText: valid.data.proposalText,
      status: "SUBMITTED",
    },
  });
  logger.info("partnerships.submitted", {
    requestId: request.id,
    organizationId: valid.data.organizationId,
    requesterId,
  });
  return request;
}

/**
 * Get a partnership request. Visible to admin, partnership_manager,
 * the requester, or a verified rep of the org.
 */
export async function getPartnershipRequest(requestId: string, actorId: string) {
  const req = await db.partnershipRequest.findUnique({
    where: { id: requestId },
    include: {
      organization: { select: { id: true, legalName: true, displayName: true, status: true } },
      requester: { select: { id: true, displayName: true, email: true } },
      project: { select: { id: true, title: true, status: true } },
      decisions: {
        orderBy: { decidedAt: "desc" },
        include: { decider: { select: { id: true, displayName: true, email: true } } },
      },
      agreement: true,
    },
  });
  if (!req) throw new NotFoundError("Partnership request not found");
  // Visibility: admin OR partnership_manager OR requester OR verified rep of org
  const admin = await isAdmin(actorId);
  const pm = await isPartnershipManager(actorId);
  const isRequester = req.requesterId === actorId;
  const isRep = await isVerifiedRepresentative(actorId, req.organizationId);
  if (!admin && !pm && !isRequester && !isRep) {
    throw new NotFoundError("Partnership request not found"); // NotFound, not Forbidden
  }
  return req;
}

/**
 * List partnership requests. Admin OR partnership_manager only.
 */
export async function listPartnershipRequests(
  actorId: string,
  filter?: { status?: string; organizationId?: string; projectId?: string },
) {
  const admin = await isAdmin(actorId);
  const pm = await isPartnershipManager(actorId);
  if (!admin && !pm) {
    throw new ForbiddenError("Only admins and partnership managers can list partnership requests");
  }
  return db.partnershipRequest.findMany({
    where: {
      ...(filter?.status && { status: filter.status as Prisma.EnumPartnershipStatusFilter }),
      ...(filter?.organizationId && { organizationId: filter.organizationId }),
      ...(filter?.projectId && { projectId: filter.projectId }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      organization: { select: { id: true, legalName: true, displayName: true, status: true } },
      requester: { select: { id: true, displayName: true, email: true } },
      project: { select: { id: true, title: true } },
    },
  });
}

/**
 * Decide on a partnership request (APPROVE/REJECT/REQUEST_REVISION).
 * Atomic: optimistic lock on status + creates PartnershipDecision + audit event.
 *
 * Anti-self-decision: deciderId !== requesterId (conflict of interest).
 * Decider must be partnership_manager or admin.
 */
export async function decidePartnershipRequest(
  requestId: string,
  deciderId: string,
  input: PartnershipDecisionInput,
) {
  const valid = partnershipDecisionSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid decision data", fields);
  }
  const req = await db.partnershipRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("Partnership request not found");
  // Decider must be partnership_manager or admin (NOT moderator)
  const admin = await isAdmin(deciderId);
  const pm = await isPartnershipManager(deciderId);
  if (!admin && !pm) {
    throw new ForbiddenError("Only partnership managers or admins can decide partnership requests");
  }
  // Anti-self-decision
  if (req.requesterId === deciderId) {
    throw new ForbiddenError("Cannot decide on your own partnership request (conflict of interest)");
  }
  // Status transitions: SUBMITTED → UNDER_REVIEW (allowed), APPROVED/REJECTED (only from UNDER_REVIEW or SUBMITTED),
  // REQUEST_REVISION → back to UNDER_REVIEW (or stays in UNDER_REVIEW for revision)
  // For simplicity: any non-terminal status can transition to any of the 3 decision outcomes
  if (["APPROVED", "REJECTED", "WITHDRAWN"].includes(req.status)) {
    throw new ConflictError(`Partnership request is ${req.status}; cannot decide`);
  }
  // If approving, agreement evidence must be CLEAN (if uploaded)
  if (valid.data.action === "APPROVE" && req.status !== "APPROVED") {
    const agreement = await db.agreementReference.findUnique({
      where: { partnershipRequestId: requestId },
      select: { scanStatus: true },
    });
    if (agreement && agreement.scanStatus !== "CLEAN") {
      throw new ConflictError(
        `Agreement evidence scan status is ${agreement.scanStatus}; only CLEAN agreements can approve a partnership`,
      );
    }
  }

  // Atomic: create decision + transition status + audit event
  const result = await db.$transaction(async (tx) => {
    // Create the decision record (audit trail)
    const decision = await tx.partnershipDecision.create({
      data: {
        partnershipRequestId: requestId,
        deciderId,
        action: valid.data.action,
        reason: valid.data.reason,
      },
    });
    // Transition status (optimistic lock)
    let newStatus: "UNDER_REVIEW" | "APPROVED" | "REJECTED";
    if (valid.data.action === "APPROVE") {
      newStatus = "APPROVED";
    } else if (valid.data.action === "REJECT") {
      newStatus = "REJECTED";
    } else {
      newStatus = "UNDER_REVIEW"; // REQUEST_REVISION → back to UNDER_REVIEW
    }
    const updated = await tx.partnershipRequest.updateMany({
      where: { id: requestId, status: { notIn: ["APPROVED", "REJECTED", "WITHDRAWN"] } },
      data: { status: newStatus, decidedAt: newStatus === "APPROVED" || newStatus === "REJECTED" ? new Date() : null },
    });
    if (updated.count === 0) {
      throw new ConflictError("Partnership request is no longer in a decidable state (concurrent transition)");
    }
    // Audit event
    await tx.auditEvent.create({
      data: buildAuditData({
        actorId: deciderId,
        action: `partnership.${valid.data.action.toLowerCase()}`,
        targetType: "PartnershipRequest",
        targetId: requestId,
        outcome: "success",
        reason: valid.data.reason,
      }),
    });
    return { decision, newStatus };
  });

  // Best-effort notification to requester
  try {
    const notifType =
      valid.data.action === "APPROVE" ? "partnership.approved"
      : valid.data.action === "REJECT" ? "partnership.rejected"
      : "partnership.revision_requested";
    const title =
      valid.data.action === "APPROVE" ? "تمت الموافقة على الشراكة / Partnership approved"
      : valid.data.action === "REJECT" ? "تم رفض الشراكة / Partnership rejected"
      : "طلب تعديلات على الشراكة / Partnership revision requested";
    await notify(req.requesterId, notifType, title, valid.data.reason);
  } catch (e) {
    logger.warn("partnerships.decide.notification_failed", {
      requestId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  logger.info("partnerships.decided", {
    requestId,
    action: valid.data.action,
    deciderId,
    decisionId: result.decision.id,
  });
  return { decisionId: result.decision.id, newStatus: result.newStatus };
}

/**
 * Withdraw a partnership request. Only the requester can withdraw.
 */
export async function withdrawPartnershipRequest(requestId: string, actorId: string) {
  const req = await db.partnershipRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("Partnership request not found");
  if (req.requesterId !== actorId) {
    throw new ForbiddenError("Only the requester can withdraw a partnership request");
  }
  if (["APPROVED", "REJECTED", "WITHDRAWN"].includes(req.status)) {
    throw new ConflictError(`Partnership request is ${req.status}; cannot withdraw`);
  }
  const result = await db.partnershipRequest.updateMany({
    where: { id: requestId, status: { notIn: ["APPROVED", "REJECTED", "WITHDRAWN"] } },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Partnership request is no longer withdrawable (concurrent transition)");
  }
  logger.info("partnerships.withdrawn", { requestId, actorId });
  return { id: requestId, status: "WITHDRAWN" as const };
}

// ---------------------------------------------------------------------------
// Agreement References
// ---------------------------------------------------------------------------

/**
 * Upload an agreement reference (evidence, NOT a generated contract).
 * The storageKey is provided externally; the file content is the caller's
 * responsibility. scanStatus starts at PENDING (fail-closed).
 *
 * Can be done by the requester, a verified rep of the org, or admin.
 */
export async function uploadAgreementReference(
  requestId: string,
  uploaderId: string,
  input: AgreementUploadInput,
) {
  const valid = agreementUploadSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid agreement metadata", fields);
  }
  const req = await db.partnershipRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("Partnership request not found");
  // Visibility + authorization
  const admin = await isAdmin(uploaderId);
  const isRep = await isVerifiedRepresentative(uploaderId, req.organizationId);
  if (!admin && req.requesterId !== uploaderId && !isRep) {
    throw new NotFoundError("Partnership request not found"); // NotFound, not Forbidden
  }
  // One agreement per partnership (unique constraint)
  const existing = await db.agreementReference.findUnique({
    where: { partnershipRequestId: requestId },
  });
  if (existing) {
    throw new ConflictError("An agreement reference already exists for this partnership");
  }
  const agreement = await db.agreementReference.create({
    data: {
      partnershipRequestId: requestId,
      storageKey: valid.data.storageKey,
      fileName: valid.data.fileName,
      mimeType: valid.data.mimeType,
      sizeBytes: valid.data.sizeBytes,
      scanStatus: "PENDING", // fail-closed; cannot be used as evidence until CLEAN
      uploadedById: uploaderId,
    },
  });
  logger.info("partnerships.agreement.uploaded", {
    agreementId: agreement.id,
    requestId,
    uploaderId,
    scanStatus: "PENDING",
  });
  return agreement;
}

/**
 * Get agreement metadata. No actual file content (storage adapter is G07).
 * Read URL is only issued if scanStatus === CLEAN (fail-closed).
 */
export async function getAgreementMetadata(requestId: string, actorId: string) {
  const req = await db.partnershipRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("Partnership request not found");
  const admin = await isAdmin(actorId);
  const pm = await isPartnershipManager(actorId);
  const isRep = await isVerifiedRepresentative(actorId, req.organizationId);
  if (!admin && !pm && req.requesterId !== actorId && !isRep) {
    throw new NotFoundError("Partnership request not found");
  }
  return db.agreementReference.findUnique({ where: { partnershipRequestId: requestId } });
}

/**
 * Get a signed read URL for the agreement file. Fail-closed:
 * only issued if scanStatus === CLEAN. The actual signed-URL generation
 * is G07 work; for G06 we return a placeholder opaque URL only when CLEAN.
 *
 * Per MASTER constraint: "لا يجوز إصدار روابط فعلية لتحميل اتفاقيات أو
 * مستندات لم تُفحص أمنياً." — never issue real download links for
 * unscanned documents.
 */
export async function getAgreementReadUrl(requestId: string, actorId: string): Promise<{
  agreementId: string;
  fileName: string;
  scanStatus: string;
  readUrl: string | null;
  reason?: string;
}> {
  const agreement = await getAgreementMetadata(requestId, actorId);
  if (!agreement) throw new NotFoundError("Agreement reference not found");
  if (agreement.scanStatus !== "CLEAN") {
    return {
      agreementId: agreement.id,
      fileName: agreement.fileName,
      scanStatus: agreement.scanStatus,
      readUrl: null,
      reason: `Agreement scan status is ${agreement.scanStatus}; only CLEAN agreements can be downloaded (fail-closed)`,
    };
  }
  // G06 placeholder: real signed URL is G07 work
  return {
    agreementId: agreement.id,
    fileName: agreement.fileName,
    scanStatus: agreement.scanStatus,
    readUrl: `storage://placeholder/${agreement.storageKey}?signed=g06-token`,
  };
}

/**
 * Suspend operational reliance on an agreement (e.g., if scan later returns INFECTED).
 * The historical APPROVED decision is preserved; only the operational reliance
 * is suspended pending institutional review. NO automated legal cancellation.
 *
 * Admin only.
 */
export async function suspendAgreementReliance(
  requestId: string,
  actorId: string,
  reason: string,
) {
  if (reason.trim().length < 10) {
    throw new ValidationError("Suspension reason must be at least 10 characters");
  }
  if (!(await isAdmin(actorId))) {
    throw new ForbiddenError("Only admins can suspend agreement reliance");
  }
  const req = await db.partnershipRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new NotFoundError("Partnership request not found");
  if (req.status !== "APPROVED") {
    throw new ConflictError("Can only suspend agreement reliance for APPROVED partnerships");
  }
  if (req.agreementSuspendedAt) {
    throw new ConflictError("Agreement reliance is already suspended");
  }
  const result = await db.partnershipRequest.update({
    where: { id: requestId },
    data: {
      agreementSuspendedAt: new Date(),
      agreementSuspendReason: reason,
    },
  });
  await db.auditEvent.create({
    data: buildAuditData({
      actorId,
      action: "partnership.agreement_suspend",
      targetType: "PartnershipRequest",
      targetId: requestId,
      outcome: "success",
      reason,
    }),
  });
  logger.info("partnerships.agreement.suspended", { requestId, actorId });
  return { id: requestId, agreementSuspendedAt: result.agreementSuspendedAt };
}

// ---------------------------------------------------------------------------
// Contribution Rights Declarations
// ---------------------------------------------------------------------------

/**
 * Submit a rights declaration for an accepted contribution.
 * Optional — a contribution can exist without one.
 *
 * Per MASTER constraint: the declaration is a CLAIM, not an IP transfer.
 * declarationType semantics:
 *   - LICENSE_GRANTED: license to use (NOT ownership transfer)
 *   - ATTRIBUTION_ONLY: explicit no-transfer, attribution only
 *   - WORK_FOR_HIRE: contributor's declaration of work-for-hire status (claim, NOT proof)
 *   - OTHER: see declarationText
 *
 * Can be submitted by:
 *   - The contributor themselves
 *   - A verified rep of the contributor's organization (if contributor has one)
 *   - An admin
 */
export async function submitRightsDeclaration(
  contributionId: string,
  declarerId: string,
  input: RightsDeclarationInput,
) {
  const valid = rightsDeclarationSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid rights declaration data", fields);
  }
  const contribution = await db.contributionReference.findUnique({
    where: { id: contributionId },
    include: { contributor: { select: { id: true, displayName: true, email: true } } },
  });
  if (!contribution) throw new NotFoundError("Contribution not found");
  // Authorization: contributor OR admin
  const admin = await isAdmin(declarerId);
  if (contribution.contributorId !== declarerId && !admin) {
    throw new ForbiddenError("Only the contributor or an admin can submit a rights declaration");
  }
  // One declaration per contribution (unique constraint)
  const existing = await db.contributionRightsDeclaration.findUnique({
    where: { contributionId },
  });
  if (existing) {
    throw new ConflictError("A rights declaration already exists for this contribution");
  }
  // G09-P2 Gap 3: atomic — declaration creation + audit in one transaction.
  // Per ChatGPT review: rights declarations may carry legal/governance
  // implications, so this is classified as HIGH-risk (moved from Group C
  // to Group A). If the audit write fails, the declaration creation rolls
  // back — no rights declaration without an audit trail.
  const declaration = await db.$transaction(async (tx) => {
    const created = await tx.contributionRightsDeclaration.create({
      data: {
        contributionId,
        declaredById: declarerId,
        declarationType: valid.data.declarationType,
        declarationText: valid.data.declarationText,
        evidenceStorageKey: valid.data.evidenceStorageKey || null,
        evidenceScanStatus: valid.data.evidenceStorageKey ? "PENDING" : null,
      },
    });
    await tx.auditEvent.create({
      data: buildAuditData({
        actorId: declarerId,
        action: "rights.declare",
        targetType: "ContributionReference",
        targetId: contributionId,
        outcome: "success",
        reason: `Declared as ${valid.data.declarationType}`,
      }),
    });
    return created;
  });
  logger.info("partnerships.rights.declared", {
    declarationId: declaration.id,
    contributionId,
    declarationType: valid.data.declarationType,
    declarerId,
  });
  return declaration;
}

/**
 * Get the rights declaration for a contribution (if any).
 * Visible to the contributor, project participants, and admins.
 */
export async function getRightsDeclaration(contributionId: string, actorId: string) {
  const contribution = await db.contributionReference.findUnique({
    where: { id: contributionId },
    include: {
      project: {
        include: { team: { include: { memberships: { where: { leftAt: null } } } } },
      },
    },
  });
  if (!contribution) throw new NotFoundError("Contribution not found");
  const admin = await isAdmin(actorId);
  const isContributor = contribution.contributorId === actorId;
  const isProjectParticipant =
    contribution.project.leadId === actorId ||
    contribution.project.stewardId === actorId ||
    (contribution.project.team?.memberships.some((m) => m.userId === actorId) ?? false);
  if (!admin && !isContributor && !isProjectParticipant) {
    throw new NotFoundError("Contribution not found"); // NotFound, not Forbidden
  }
  return db.contributionRightsDeclaration.findUnique({
    where: { contributionId },
    include: {
      declaredBy: { select: { id: true, displayName: true, email: true } },
      reviewedBy: { select: { id: true, displayName: true, email: true } },
    },
  });
}
