/**
 * STR Organizations — Organization + Representative Service (G06-A)
 * -------------------------------------------------------------
 * Implements the organization lifecycle with INSTITUTIONAL AUTHORIZATION:
 *
 *   Organization: PENDING_VERIFICATION → ACTIVE → SUSPENDED | REVOKED
 *   Representative: registered → verified → (optionally revoked)
 *
 * Architectural constraints (per MASTER G06 Authorization):
 *   1. A representative CANNOT verify their own delegated authority —
 *      requires independent admin. Enforced in verifyRepresentative().
 *   2. Only admin can verify/suspend/revoke organizations and representatives.
 *   3. RoleGrant uses string for role — new roles "partnership_manager" and
 *      "moderator" require no schema changes; service layer checks them.
 *   4. Service-layer authorization (UI is not authoritative).
 *   5. No leakage: organization + representative records visible only to
 *      admins and the org's own verified representatives (NotFound otherwise).
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

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const organizationCreateSchema = z.object({
  legalName: z.string().min(2).max(200),
  displayName: z.string().min(2).max(200),
  email: z.string().email().max(255),
  website: z.string().url().max(500).optional(),
});
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;

export const representativeAddSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["signatory", "liaison", "observer"]),
  delegatedAuthorityScope: z.string().min(10).max(5000),
});
export type RepresentativeAddInput = z.infer<typeof representativeAddSchema>;

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

/**
 * Check if user is a global admin.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const grant = await db.roleGrant.findFirst({
    where: { userId, role: "admin", scope: "global", revokedAt: null },
  });
  return !!grant;
}

/**
 * Check if user is a partnership_manager (new G06 role).
 */
export async function isPartnershipManager(userId: string): Promise<boolean> {
  const grant = await db.roleGrant.findFirst({
    where: { userId, role: "partnership_manager", scope: "global", revokedAt: null },
  });
  return !!grant;
}

/**
 * Check if user is a moderator (new G06 role).
 */
export async function isModerator(userId: string): Promise<boolean> {
  const grant = await db.roleGrant.findFirst({
    where: { userId, role: "moderator", scope: "global", revokedAt: null },
  });
  return !!grant;
}

/**
 * Assert the actor is admin (only admin can verify/suspend/revoke orgs).
 */
async function assertAdmin(userId: string): Promise<void> {
  if (!(await isAdmin(userId))) {
    throw new ForbiddenError("Only admins can perform this action");
  }
}

/**
 * Load organization context. Returns null if org doesn't exist.
 */
export async function loadOrganizationContext(orgId: string, actorId: string) {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: {
      representatives: {
        where: { revokedAt: null },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      },
    },
  });
  if (!org) return null;
  const admin = await isAdmin(actorId);
  // A user can see the org if they're admin OR a verified representative of it
  const isRep = org.representatives.some(
    (r) => r.userId === actorId && r.verifiedAt !== null,
  );
  return { org, isAdmin: admin, isVerifiedRep: isRep };
}

// ---------------------------------------------------------------------------
// Organization CRUD + lifecycle
// ---------------------------------------------------------------------------

/**
 * Register a new organization. Anyone can register; org starts PENDING_VERIFICATION.
 * Only admin can verify it later.
 */
export async function registerOrganization(
  registeredById: string,
  input: OrganizationCreateInput,
) {
  const valid = organizationCreateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid organization data", fields);
  }
  // Email is unique — check
  const existing = await db.organization.findUnique({
    where: { email: valid.data.email },
  });
  if (existing) {
    throw new ConflictError("An organization with this email already exists");
  }
  const org = await db.organization.create({
    data: {
      legalName: valid.data.legalName,
      displayName: valid.data.displayName,
      email: valid.data.email,
      website: valid.data.website,
      status: "PENDING_VERIFICATION",
    },
  });
  logger.info("organizations.registered", {
    organizationId: org.id,
    registeredById,
    email: org.email,
  });
  return org;
}

/**
 * Get organization by ID. Visible to admin OR verified rep.
 */
export async function getOrganization(orgId: string, actorId: string) {
  const ctx = await loadOrganizationContext(orgId, actorId);
  if (!ctx) throw new NotFoundError("Organization not found");
  if (!ctx.isAdmin && !ctx.isVerifiedRep) {
    // NotFound (not Forbidden) — no ID enumeration
    throw new NotFoundError("Organization not found");
  }
  return ctx.org;
}

/**
 * List organizations. Admin only.
 */
export async function listOrganizations(actorId: string, filter?: { status?: string }) {
  await assertAdmin(actorId);
  return db.organization.findMany({
    where: filter?.status ? { status: filter.status as Prisma.EnumOrganizationStatusFilter } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { representatives: true, partnershipRequests: true } },
    },
  });
}

/**
 * Verify organization (PENDING_VERIFICATION → ACTIVE). Admin only.
 * Atomic with optimistic lock.
 */
export async function verifyOrganization(orgId: string, actorId: string) {
  await assertAdmin(actorId);
  const result = await db.organization.updateMany({
    where: { id: orgId, status: "PENDING_VERIFICATION" },
    data: { status: "ACTIVE", verifiedAt: new Date(), verifiedById: actorId },
  });
  if (result.count === 0) {
    throw new ConflictError("Organization is not in PENDING_VERIFICATION status (concurrent transition)");
  }
  // Audit event
  await db.auditEvent.create({
    data: buildAuditData({
      actorId,
      action: "organization.verify",
      targetType: "Organization",
      targetId: orgId,
      outcome: "success",
    }),
  });
  logger.info("organizations.verified", { organizationId: orgId, actorId });
  return { id: orgId, status: "ACTIVE" as const };
}

/**
 * Suspend organization (ACTIVE → SUSPENDED). Admin only. Reversible.
 */
export async function suspendOrganization(
  orgId: string,
  actorId: string,
  reason: string,
) {
  if (reason.trim().length < 10) {
    throw new ValidationError("Suspension reason must be at least 10 characters");
  }
  await assertAdmin(actorId);
  const result = await db.organization.updateMany({
    where: { id: orgId, status: "ACTIVE" },
    data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: reason },
  });
  if (result.count === 0) {
    throw new ConflictError("Organization is not in ACTIVE status (concurrent transition)");
  }
  await db.auditEvent.create({
    data: buildAuditData({
      actorId,
      action: "organization.suspend",
      targetType: "Organization",
      targetId: orgId,
      outcome: "success",
      reason,
    }),
  });
  logger.info("organizations.suspended", { organizationId: orgId, actorId });
  return { id: orgId, status: "SUSPENDED" as const };
}

/**
 * Reactivate organization (SUSPENDED → ACTIVE). Admin only.
 */
export async function reactivateOrganization(orgId: string, actorId: string) {
  await assertAdmin(actorId);
  const result = await db.organization.updateMany({
    where: { id: orgId, status: "SUSPENDED" },
    data: { status: "ACTIVE", suspendedAt: null, suspendedReason: null },
  });
  if (result.count === 0) {
    throw new ConflictError("Organization is not in SUSPENDED status (concurrent transition)");
  }
  await db.auditEvent.create({
    data: buildAuditData({
      actorId,
      action: "organization.reactivate",
      targetType: "Organization",
      targetId: orgId,
      outcome: "success",
    }),
  });
  logger.info("organizations.reactivated", { organizationId: orgId, actorId });
  return { id: orgId, status: "ACTIVE" as const };
}

/**
 * Revoke organization (any non-terminal → REVOKED). Admin only. Terminal.
 */
export async function revokeOrganization(
  orgId: string,
  actorId: string,
  reason: string,
) {
  if (reason.trim().length < 10) {
    throw new ValidationError("Revocation reason must be at least 10 characters");
  }
  await assertAdmin(actorId);
  const result = await db.organization.updateMany({
    where: { id: orgId, status: { not: "REVOKED" } },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason },
  });
  if (result.count === 0) {
    throw new ConflictError("Organization is already REVOKED");
  }
  await db.auditEvent.create({
    data: buildAuditData({
      actorId,
      action: "organization.revoke",
      targetType: "Organization",
      targetId: orgId,
      outcome: "success",
      reason,
    }),
  });
  logger.info("organizations.revoked", { organizationId: orgId, actorId });
  return { id: orgId, status: "REVOKED" as const };
}

// ---------------------------------------------------------------------------
// Representative CRUD + verification
// ---------------------------------------------------------------------------

/**
 * Add a representative to an organization.
 * Can be done by admin OR a verified representative of the org (e.g., the
 * signatory adds a liaison). The new rep starts UNVERIFIED.
 *
 * NOTE: the new rep CANNOT self-verify — only an independent admin can.
 */
export async function addRepresentative(
  orgId: string,
  actorId: string,
  input: RepresentativeAddInput,
) {
  const valid = representativeAddSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid representative data", fields);
  }
  const ctx = await loadOrganizationContext(orgId, actorId);
  if (!ctx) throw new NotFoundError("Organization not found");
  // Admin OR verified rep can add
  if (!ctx.isAdmin && !ctx.isVerifiedRep) {
    throw new NotFoundError("Organization not found"); // NotFound, not Forbidden
  }
  // Org must be ACTIVE (or admin can override)
  if (ctx.org.status !== "ACTIVE" && !ctx.isAdmin) {
    throw new ConflictError(`Organization is ${ctx.org.status}; cannot add representatives`);
  }
  // Can't add the same user twice
  const existing = await db.organizationRepresentative.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: valid.data.userId } },
  });
  if (existing && existing.revokedAt === null) {
    throw new ConflictError("User is already an active representative of this organization");
  }
  const rep = await db.organizationRepresentative.create({
    data: {
      organizationId: orgId,
      userId: valid.data.userId,
      role: valid.data.role,
      delegatedAuthorityScope: valid.data.delegatedAuthorityScope,
      // verifiedAt starts null — requires independent admin verification
    },
  });
  logger.info("organizations.rep.added", {
    organizationId: orgId,
    representativeId: rep.id,
    userId: valid.data.userId,
    actorId,
  });
  return rep;
}

/**
 * Verify a representative's delegated authority.
 * CRITICAL: Admin only — a representative CANNOT verify themselves.
 * Anti-self-verification guard: if verifierId === rep.userId → ForbiddenError.
 */
export async function verifyRepresentative(repId: string, verifierId: string) {
  await assertAdmin(verifierId);
  const rep = await db.organizationRepresentative.findUnique({
    where: { id: repId },
  });
  if (!rep) throw new NotFoundError("Representative not found");
  // Anti-self-verification — the verifier must NOT be the same user as the rep
  if (rep.userId === verifierId) {
    throw new ForbiddenError(
      "Cannot verify your own delegated authority — requires independent admin verification",
    );
  }
  if (rep.revokedAt !== null) {
    throw new ConflictError("Representative has been revoked; cannot verify");
  }
  if (rep.verifiedAt !== null) {
    throw new ConflictError("Representative is already verified");
  }
  const result = await db.organizationRepresentative.updateMany({
    where: { id: repId, verifiedAt: null, revokedAt: null },
    data: { verifiedAt: new Date(), verifiedById: verifierId },
  });
  if (result.count === 0) {
    throw new ConflictError("Representative is no longer in a verifiable state (concurrent transition)");
  }
  await db.auditEvent.create({
    data: buildAuditData({
      actorId: verifierId,
      action: "representative.verify",
      targetType: "OrganizationRepresentative",
      targetId: repId,
      outcome: "success",
    }),
  });
  logger.info("organizations.rep.verified", { representativeId: repId, verifierId });
  return { id: repId, verifiedAt: new Date().toISOString() };
}

/**
 * Revoke a representative. Admin only.
 */
export async function revokeRepresentative(
  repId: string,
  actorId: string,
  reason: string,
) {
  if (reason.trim().length < 10) {
    throw new ValidationError("Revocation reason must be at least 10 characters");
  }
  await assertAdmin(actorId);
  const rep = await db.organizationRepresentative.findUnique({ where: { id: repId } });
  if (!rep) throw new NotFoundError("Representative not found");
  if (rep.revokedAt !== null) {
    throw new ConflictError("Representative is already revoked");
  }
  const result = await db.organizationRepresentative.updateMany({
    where: { id: repId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  if (result.count === 0) {
    throw new ConflictError("Representative is no longer revocable (concurrent transition)");
  }
  await db.auditEvent.create({
    data: buildAuditData({
      actorId,
      action: "representative.revoke",
      targetType: "OrganizationRepresentative",
      targetId: repId,
      outcome: "success",
      reason,
    }),
  });
  logger.info("organizations.rep.revoked", { representativeId: repId, actorId });
  return { id: repId, revokedAt: new Date().toISOString() };
}

/**
 * List representatives of an organization. Visible to admin OR verified rep.
 */
export async function listRepresentatives(orgId: string, actorId: string) {
  const ctx = await loadOrganizationContext(orgId, actorId);
  if (!ctx) throw new NotFoundError("Organization not found");
  if (!ctx.isAdmin && !ctx.isVerifiedRep) {
    throw new NotFoundError("Organization not found");
  }
  return db.organizationRepresentative.findMany({
    where: { organizationId: orgId },
    include: {
      user: { select: { id: true, displayName: true, email: true } },
      verifiedBy: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Check if a user is a verified representative of an organization.
 * Used by the partnerships service to validate requester authority.
 */
export async function isVerifiedRepresentative(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const rep = await db.organizationRepresentative.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { verifiedAt: true, revokedAt: true },
  });
  return !!rep && rep.verifiedAt !== null && rep.revokedAt === null;
}
