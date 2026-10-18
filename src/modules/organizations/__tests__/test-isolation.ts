/**
 * STR G06 — Test Database Isolation Helper for Organizations + Partnerships
 * Each test creates a unique "test run" with a random ID. All G06 entities
 * (organizations + representatives + partnership requests + decisions +
 * agreements + rights declarations) are scoped to a single test run.
 */
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";

export interface TestRun {
  runId: string;
  userIds: string[];
  organizationIds: string[];
  partnershipRequestIds: string[];
  projectIds: string[];
  proposalIds: string[];
}

export function startTestRun(): TestRun {
  return {
    runId: randomBytes(4).toString("hex"),
    userIds: [],
    organizationIds: [],
    partnershipRequestIds: [],
    projectIds: [],
    proposalIds: [],
  };
}

export async function createTestUser(
  run: TestRun,
  role: "admin" | "partnership_manager" | "moderator" | "member" | "rep",
): Promise<string> {
  const email = `g06-${role}-${run.runId}-${run.userIds.length}@test.local`;
  const grants = role === "admin"
    ? [{ role: "member", scope: "global" }, { role: "reviewer", scope: "global" }, { role: "admin", scope: "global" }]
    : role === "partnership_manager"
      ? [{ role: "member", scope: "global" }, { role: "partnership_manager", scope: "global" }]
      : role === "moderator"
        ? [{ role: "member", scope: "global" }, { role: "moderator", scope: "global" }]
        : role === "rep"
          ? [{ role: "member", scope: "global" }]
          : [{ role: "member", scope: "global" }];
  const user = await db.user.create({
    data: {
      email,
      displayName: `G06 ${role} ${run.runId}`,
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: grants },
    },
  });
  run.userIds.push(user.id);
  return user.id;
}

export async function createTestOrganization(
  run: TestRun,
  creatorId: string,
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "REVOKED" = "PENDING_VERIFICATION",
): Promise<string> {
  const org = await db.organization.create({
    data: {
      legalName: `G06 Test Org ${run.runId}-${run.organizationIds.length}`,
      displayName: `G06 Org ${run.runId}`,
      email: `g06-org-${run.runId}-${run.organizationIds.length}@test.local`,
      status,
      ...(status === "ACTIVE" ? { verifiedAt: new Date(), verifiedById: creatorId } : {}),
    },
  });
  run.organizationIds.push(org.id);
  return org.id;
}

export async function createTestRepresentative(
  run: TestRun,
  organizationId: string,
  userId: string,
  verified: boolean,
  verifierId?: string,
): Promise<string> {
  const rep = await db.organizationRepresentative.create({
    data: {
      organizationId,
      userId,
      role: "signatory",
      delegatedAuthorityScope: `Authority to sign partnership requests on behalf of the organization for run ${run.runId}`,
      ...(verified ? { verifiedAt: new Date(), verifiedById: verifierId || userId } : {}),
    },
  });
  return rep.id;
}

export async function cleanupTestRun(run: TestRun): Promise<void> {
  // Delete projects + their child entities first (cascade handles children)
  if (run.projectIds.length > 0) {
    // Project cascades: milestones, tasks, deliverables, contributions, threads, etc.
    // But we need to handle G06 entities that reference projects too
    await db.moderationComplaint.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.impactRecord.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.partnershipRequest.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.projectThread.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.project.deleteMany({ where: { id: { in: run.projectIds } } });
  }
  if (run.proposalIds.length > 0) {
    await db.reviewDecision.deleteMany({ where: { proposalId: { in: run.proposalIds } } });
    await db.charterRevision.deleteMany({ where: { proposalId: { in: run.proposalIds } } });
    await db.projectProposal.deleteMany({ where: { id: { in: run.proposalIds } } });
  }
  if (run.partnershipRequestIds.length > 0) {
    await db.contributionRightsDeclaration.deleteMany({
      where: { contribution: { deliverable: { task: { project: { partnershipRequests: { some: { id: { in: run.partnershipRequestIds } } } } } } } },
    });
    await db.partnershipDecision.deleteMany({
      where: { partnershipRequestId: { in: run.partnershipRequestIds } },
    });
    await db.agreementReference.deleteMany({
      where: { partnershipRequestId: { in: run.partnershipRequestIds } },
    });
    await db.partnershipRequest.deleteMany({
      where: { id: { in: run.partnershipRequestIds } },
    });
  }
  if (run.organizationIds.length > 0) {
    await db.organizationRepresentative.deleteMany({
      where: { organizationId: { in: run.organizationIds } },
    });
    await db.organization.deleteMany({ where: { id: { in: run.organizationIds } } });
  }
  if (run.userIds.length > 0) {
    await db.auditEvent.deleteMany({ where: { actorId: { in: run.userIds } } });
    await db.notification.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.roleGrant.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.organizationRepresentative.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.user.deleteMany({ where: { id: { in: run.userIds } } });
  }
}
