/**
 * STR G05 — Test Database Isolation Helper for Project Execution
 * ----------------------------------------------------------------
 * Each test creates a unique "test run" with a random ID. All G05 entities
 * (project + team + memberships + milestones + tasks + deliverables + versions
 * + reviews + contributions + files) are scoped to a single test run.
 *
 * Cleanup deletes ONLY that run's data via the runId tag.
 */
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";

export interface TestRun {
  runId: string;
  userIds: string[];
  projectIds: string[];
  proposalIds: string[];
}

export function startTestRun(): TestRun {
  return {
    runId: randomBytes(4).toString("hex"),
    userIds: [],
    projectIds: [],
    proposalIds: [],
  };
}

/**
 * Create a test user with a specific role.
 * Roles: "lead" | "steward" | "member" | "reviewer" | "admin"
 */
export async function createTestUser(
  run: TestRun,
  role: "lead" | "steward" | "member" | "reviewer" | "admin",
): Promise<string> {
  const email = `g05-${role}-${run.runId}-${run.userIds.length}@test.local`;
  const user = await db.user.create({
    data: {
      email,
      displayName: `G05 ${role} ${run.runId}`,
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants:
        role === "member"
          ? { create: [{ role: "member", scope: "global" }] }
          : role === "reviewer"
            ? { create: [{ role: "member", scope: "global" }, { role: "reviewer", scope: "global" }] }
            : role === "steward"
              ? { create: [{ role: "member", scope: "global" }, { role: "reviewer", scope: "global" }, { role: "steward", scope: "global" }] }
              : role === "lead"
                ? { create: [{ role: "member", scope: "global" }] }
                : role === "admin"
                  ? { create: [{ role: "member", scope: "global" }, { role: "reviewer", scope: "global" }, { role: "admin", scope: "global" }] }
                  : { create: [{ role: "member", scope: "global" }] },
    },
  });
  run.userIds.push(user.id);
  return user.id;
}

const validCharter = {
  problemStatement: `Test problem statement for run ${randomBytes(2).toString("hex")} — sufficient length for validation.`,
  outcomes: `Test outcomes for run ${randomBytes(2).toString("hex")} — sufficient length for validation.`,
  scope: `Test scope for run ${randomBytes(2).toString("hex")} — sufficient length for validation.`,
  exclusions: "Test exclusions",
  beneficiaries: "Test beneficiaries",
  requiredSkills: ["TypeScript", "PostgreSQL"],
  resources: "Test resources",
  risks: "Test risks",
  rights: "Test rights",
  acceptanceCriteria: `Test acceptance criteria ${randomBytes(2).toString("hex")} — sufficient length.`,
};

/**
 * Create a complete approved project for testing G05 workflows.
 * Uses the G03 service (createProposal → submit → review APPROVE) so the
 * atomic Project + Team + Steward + Lead creation is exercised end-to-end.
 *
 * Returns { projectId, proposalId, leadId, stewardId, memberId }.
 */
export async function createTestProject(run: TestRun): Promise<{
  projectId: string;
  proposalId: string;
  leadId: string;
  stewardId: string;
  memberId: string;
}> {
  const leadId = await createTestUser(run, "lead");
  const stewardId = await createTestUser(run, "steward");
  const reviewerId = await createTestUser(run, "reviewer");
  const memberId = await createTestUser(run, "member");

  // 1. Create + submit a proposal
  const proposal = await createProposal({
    submitterId: leadId,
    title: `G05 Test Project ${run.runId}`,
    charter: validCharter,
  });
  run.proposalIds.push(proposal.id);
  await submitProposal(proposal.id, leadId);

  // 2. Reviewer approves with steward assignment (atomic project creation)
  await reviewProposal({
    proposalId: proposal.id,
    reviewerId,
    action: "APPROVE",
    reason: `Approved for G05 testing run ${run.runId}.`,
    stewardId,
  });

  // 3. The project is now created atomically with team + steward + lead
  const project = await db.project.findUnique({
    where: { proposalId: proposal.id },
  });
  if (!project) throw new Error("Project was not created after approval");
  run.projectIds.push(project.id);

  // 4. Add the additional member to the team (lead invites, member accepts)
  const team = await db.team.findFirst({ where: { projectId: project.id } });
  if (team) {
    await db.teamMembership.create({
      data: { teamId: team.id, userId: memberId, role: "MEMBER" },
    });
  }

  return {
    projectId: project.id,
    proposalId: proposal.id,
    leadId,
    stewardId,
    memberId,
  };
}

/**
 * Cleanup all data created during this test run.
 * Deletion order matters for FK constraints — delete children first.
 */
export async function cleanupTestRun(run: TestRun): Promise<void> {
  if (run.projectIds.length === 0 && run.proposalIds.length === 0 && run.userIds.length === 0) {
    return;
  }

  // Delete G05 entities first (they reference projects + users)
  if (run.projectIds.length > 0) {
    await db.contributionReference.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.fileEvidence.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.deliverableReview.deleteMany({
      where: { deliverable: { task: { projectId: { in: run.projectIds } } } },
    });
    await db.deliverableVersion.deleteMany({
      where: { deliverable: { task: { projectId: { in: run.projectIds } } } },
    });
    await db.deliverable.deleteMany({
      where: { task: { projectId: { in: run.projectIds } } },
    });
    await db.task.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.milestone.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.stewardAssignment.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.resourceGrant.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.teamMembership.deleteMany({
      where: { team: { projectId: { in: run.projectIds } } },
    });
    await db.team.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.opportunity.deleteMany({ where: { projectId: { in: run.projectIds } } });
    await db.project.deleteMany({ where: { id: { in: run.projectIds } } });
  }

  if (run.proposalIds.length > 0) {
    await db.reviewDecision.deleteMany({ where: { proposalId: { in: run.proposalIds } } });
    await db.charterRevision.deleteMany({ where: { proposalId: { in: run.proposalIds } } });
    await db.projectProposal.deleteMany({ where: { id: { in: run.proposalIds } } });
  }

  if (run.userIds.length > 0) {
    await db.notification.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.roleGrant.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.teamMembership.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.stewardAssignment.deleteMany({ where: { stewardId: { in: run.userIds } } });
    await db.authIdentity.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.emailVerification.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.passwordReset.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.memberProfile.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.opportunityApplication.deleteMany({ where: { applicantId: { in: run.userIds } } });
    await db.opportunityReview.deleteMany({ where: { reviewerId: { in: run.userIds } } });
    await db.opportunity.deleteMany({ where: { createdById: { in: run.userIds } } });
    await db.user.deleteMany({ where: { id: { in: run.userIds } } });
  }
}
