/**
 * STR Admin — Dashboard Aggregators (G06-B)
 * ------------------------------------------
 * Read-only aggregations for admin dashboards. NO inline editing —
 * all mutations go through the existing service endpoints.
 *
 * Authorization: admin only for all endpoints.
 * NotFound (not Forbidden) for non-admins to avoid role enumeration.
 */

import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { Prisma } from "@prisma/client";
import { isAdmin } from "@/modules/organizations/service";

async function assertAdmin(userId: string) {
  if (!(await isAdmin(userId))) {
    throw new NotFoundError("Resource not found"); // NotFound, not Forbidden
  }
}

export async function getAdminDashboardStats(actorId: string) {
  await assertAdmin(actorId);
  const [
    pendingProposals,
    approvedProposals,
    rejectedProposals,
    activeProjects,
    suspendedProjects,
    completedProjects,
    pendingOrganizations,
    activeOrganizations,
    suspendedOrganizations,
    pendingPartnerships,
    approvedPartnerships,
    openModerationComplaints,
    escalatedComplaints,
  ] = await Promise.all([
    db.projectProposal.count({ where: { status: "SUBMITTED" } }),
    db.projectProposal.count({ where: { status: "APPROVED" } }),
    db.projectProposal.count({ where: { status: "REJECTED" } }),
    db.project.count({ where: { status: "ACTIVE" } }),
    db.project.count({ where: { status: "SUSPENDED" } }),
    db.project.count({ where: { status: "COMPLETED" } }),
    db.organization.count({ where: { status: "PENDING_VERIFICATION" } }),
    db.organization.count({ where: { status: "ACTIVE" } }),
    db.organization.count({ where: { status: "SUSPENDED" } }),
    db.partnershipRequest.count({ where: { status: "SUBMITTED" } }),
    db.partnershipRequest.count({ where: { status: "APPROVED" } }),
    db.moderationComplaint.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    db.moderationComplaint.count({ where: { status: "ESCALATED" } }),
  ]);
  return {
    proposals: {
      pending: pendingProposals,
      approved: approvedProposals,
      rejected: rejectedProposals,
    },
    projects: {
      active: activeProjects,
      suspended: suspendedProjects,
      completed: completedProjects,
    },
    organizations: {
      pending: pendingOrganizations,
      active: activeOrganizations,
      suspended: suspendedOrganizations,
    },
    partnerships: {
      pending: pendingPartnerships,
      approved: approvedPartnerships,
    },
    moderation: {
      open: openModerationComplaints,
      escalated: escalatedComplaints,
    },
  };
}

export async function listAllProposals(actorId: string, filter?: { status?: string }) {
  await assertAdmin(actorId);
  return db.projectProposal.findMany({
    where: filter?.status ? { status: filter.status as Prisma.EnumProposalStatusFilter } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      submitter: { select: { id: true, displayName: true, email: true } },
      project: { select: { id: true, title: true, status: true } },
    },
  });
}

export async function listAllTeams(actorId: string) {
  await assertAdmin(actorId);
  return db.team.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      project: { select: { id: true, title: true, status: true } },
      memberships: {
        where: { leftAt: null },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      },
    },
  });
}

export async function listAllGrants(actorId: string) {
  await assertAdmin(actorId);
  return db.resourceGrant.findMany({
    orderBy: { grantedAt: "desc" },
    include: {
      project: { select: { id: true, title: true } },
      actor: { select: { id: true, displayName: true, email: true } },
    },
  });
}

export async function listSuspendedProjects(actorId: string) {
  await assertAdmin(actorId);
  return db.project.findMany({
    where: { status: "SUSPENDED" },
    orderBy: { suspendedAt: "desc" },
    include: {
      lead: { select: { id: true, displayName: true, email: true } },
      steward: { select: { id: true, displayName: true, email: true } },
    },
  });
}

export async function listRecentAuditEvents(actorId: string, limit = 50) {
  await assertAdmin(actorId);
  return db.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    include: {
      user: { select: { id: true, displayName: true, email: true } },
    },
  });
}
