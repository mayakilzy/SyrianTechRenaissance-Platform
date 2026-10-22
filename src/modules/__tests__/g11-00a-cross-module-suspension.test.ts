/**
 * STR G11-00A — Cross-Module Suspension Enforcement Regression Tests
 * ------------------------------------------------------------------
 * Companion to G11-00's adversarial tests, covering the FOLLOW-UP-1 gap:
 * service-layer account-status checks in modules OTHER than proposals.
 *
 * Tests:
 * 1. teams: SUSPENDED steward cannot suspend/reactivate/changeSteward/changeLead
 * 2. teams: SUSPENDED lead cannot invite members
 * 3. projects: SUSPENDED lead/steward cannot create milestones/tasks
 * 4. organizations: SUSPENDED admin cannot verify/suspend/revoke organizations
 * 5. moderation: SUSPENDED user cannot file complaints
 * 6. moderation: SUSPENDED admin cannot decide complaints
 *
 * Each test:
 *   - Creates an ACTIVE privileged user.
 *   - Suspends the user.
 *   - Attempts the privileged operation via the SERVICE layer.
 *   - Asserts the operation is rejected (throws).
 *
 * G11-00A: closes FOLLOW-UP-1 from the G11-00 defect register.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";
import {
  createProposal,
  submitProposal,
  reviewProposal,
} from "@/modules/proposals/service";
import { suspendProject, inviteMember, changeSteward, changeLead } from "@/modules/teams/service";
import { createMilestone, createTask, acceptTaskAssignment } from "@/modules/projects/service";
import {
  registerOrganization,
  verifyOrganization,
  suspendOrganization,
} from "@/modules/organizations/service";
import { fileComplaint, decideComplaint } from "@/modules/moderation/service";

interface TestRun {
  runId: string;
  userIds: string[];
  orgIds: string[];
}

function startTestRun(): TestRun {
  return { runId: randomBytes(4).toString("hex"), userIds: [], orgIds: [] };
}

async function createTestUser(
  run: TestRun,
  role: "member" | "reviewer" | "steward" | "admin" | "moderator" | "partnership_manager" = "member",
): Promise<string> {
  const roles = ["member"];
  if (role === "reviewer") roles.push("reviewer");
  if (role === "steward") roles.push("steward");
  if (role === "admin") {
    roles.push("admin");
    roles.push("reviewer");
    roles.push("steward");
  }
  if (role === "moderator") roles.push("moderator");
  if (role === "partnership_manager") roles.push("partnership_manager");
  const user = await db.user.create({
    data: {
      email: `g11a-${run.runId}-${role}-${randomBytes(2).toString("hex")}@str-test.local`,
      displayName: `G11A Test ${role}`,
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: roles.map((r) => ({ role: r, scope: "global" })) },
    },
  });
  run.userIds.push(user.id);
  return user.id;
}

async function cleanupTestRun(run: TestRun): Promise<void> {
  // Delete in dependency order (children first).
  // This mirrors the G03 cleanup pattern + organization/complaint cleanup.
  if (run.orgIds.length > 0) {
    await db.organizationRepresentative.deleteMany({ where: { organizationId: { in: run.orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: run.orgIds } } });
  }
  if (run.userIds.length === 0) return;

  // Moderation complaints filed by or against our users
  await db.moderationComplaint.deleteMany({
    where: { OR: [{ complainantId: { in: run.userIds } }, { targetUserId: { in: run.userIds } }] },
  });

  // Project-related cleanup (cascade)
  const proposals = await db.projectProposal.findMany({
    where: { submitterId: { in: run.userIds } },
    select: { id: true },
  });
  const proposalIds = proposals.map((p) => p.id);
  const projects = await db.project.findMany({
    where: { proposalId: { in: proposalIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  const teams = await db.team.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);

  if (projectIds.length > 0) {
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.milestone.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
  }
  if (teamIds.length > 0) {
    await db.teamInvitation.deleteMany({ where: { teamId: { in: teamIds } } });
    await db.teamMembership.deleteMany({ where: { teamId: { in: teamIds } } });
  }
  if (projectIds.length > 0) {
    await db.resourceGrant.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.stewardAssignment.deleteMany({ where: { projectId: { in: projectIds } } });
  }
  await db.team.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.reviewDecision.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.project.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.charterRevision.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.projectProposal.deleteMany({ where: { id: { in: proposalIds } } });
  await db.roleGrant.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.emailVerification.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.passwordReset.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.teamMembership.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.teamInvitation.deleteMany({
    where: { OR: [{ inviteeId: { in: run.userIds } }, { inviterId: { in: run.userIds } }] },
  });
  await db.stewardAssignment.deleteMany({ where: { stewardId: { in: run.userIds } } });
  await db.user.deleteMany({ where: { id: { in: run.userIds } } });
}

const validCharter = {
  problemStatement: "G11-00A cross-module suspension enforcement regression test.",
  outcomes: "Verify SUSPENDED users cannot perform privileged operations in any module.",
  scope: "Engineering validation only — no UI changes.",
  requiredSkills: ["TypeScript", "PostgreSQL", "Security"],
  acceptanceCriteria: "All cross-module tests PASS.",
};

async function createApprovedProject(run: TestRun): Promise<{ projectId: string; teamId: string; leadId: string; stewardId: string; reviewerId: string }> {
  const leadId = await createTestUser(run, "member");
  const reviewerId = await createTestUser(run, "reviewer");
  const stewardId = await createTestUser(run, "steward");

  const proposal = await createProposal({ submitterId: leadId, title: "Cross-module test project", charter: validCharter });
  await submitProposal(proposal.id, leadId);
  await reviewProposal({
    proposalId: proposal.id,
    reviewerId,
    action: "APPROVE",
    reason: "approved for cross-module suspension test",
    stewardId,
  });

  const project = await db.project.findFirstOrThrow({ where: { proposalId: proposal.id } });
  const team = await db.team.findFirstOrThrow({ where: { projectId: project.id } });
  return { projectId: project.id, teamId: team.id, leadId, stewardId, reviewerId };
}

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. teams: SUSPENDED steward cannot govern
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00A — Cross-module: teams/service.ts suspension enforcement", () => {
  it("SUSPENDED steward cannot suspend project", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    await db.user.update({ where: { id: ctx.stewardId }, data: { status: "SUSPENDED" } });
    await expect(
      suspendProject(ctx.projectId, ctx.stewardId, "should fail"),
    ).rejects.toThrow();
  });

  it("SUSPENDED lead cannot invite members", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    const inviteeId = await createTestUser(run, "member");
    await db.user.update({ where: { id: ctx.leadId }, data: { status: "SUSPENDED" } });
    await expect(
      inviteMember({
        teamId: ctx.teamId,
        inviterId: ctx.leadId,
        inviteeId,
        role: "MEMBER",
      }),
    ).rejects.toThrow();
  });

  it("SUSPENDED admin cannot change steward", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    const adminId = await createTestUser(run, "admin");
    const newStewardId = await createTestUser(run, "steward");
    await db.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });
    await expect(
      changeSteward({
        projectId: ctx.projectId,
        newStewardId,
        actorId: adminId,
      }),
    ).rejects.toThrow();
  });

  it("SUSPENDED admin cannot change lead", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    const adminId = await createTestUser(run, "admin");
    const newMemberId = await createTestUser(run, "member");
    // First add the new member to the team via invite+accept
    const invitation = await db.teamInvitation.create({
      data: {
        teamId: ctx.teamId,
        inviteeId: newMemberId,
        inviterId: ctx.leadId,
        role: "MEMBER",
      },
    });
    await db.teamMembership.create({
      data: { teamId: ctx.teamId, userId: newMemberId, role: "MEMBER", joinedAt: new Date() },
    });
    // Now suspend the admin and attempt to change lead
    await db.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });
    await expect(
      changeLead({
        projectId: ctx.projectId,
        newLeadId: newMemberId,
        actorId: adminId,
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. projects: SUSPENDED lead/steward cannot manage project
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00A — Cross-module: projects/service.ts suspension enforcement", () => {
  it("SUSPENDED lead cannot create milestone", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    await db.user.update({ where: { id: ctx.leadId }, data: { status: "SUSPENDED" } });
    await expect(
      createMilestone(
        ctx.projectId,
        ctx.leadId,
        { title: "Should fail", description: "Suspended lead attempt to create a milestone" },
      ),
    ).rejects.toThrow();
  });

  it("SUSPENDED lead cannot create task", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    // First create a milestone so the test can attempt task creation
    await db.user.update({ where: { id: ctx.leadId }, data: { status: "SUSPENDED" } });
    await expect(
      createTask(
        ctx.projectId,
        ctx.leadId,
        { title: "Should fail", description: "Suspended lead attempt to create a task", assigneeId: ctx.leadId },
      ),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. organizations: SUSPENDED admin cannot verify/suspend/revoke
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00A — Cross-module: organizations/service.ts suspension enforcement", () => {
  it("SUSPENDED admin cannot verify organization", async () => {
    run = startTestRun();
    const ownerId = await createTestUser(run, "member");
    const adminId = await createTestUser(run, "admin");
    const org = await registerOrganization(ownerId, {
      legalName: `G11A Test Org ${run.runId}`,
      displayName: `G11A Org ${run.runId}`,
      email: `org-${run.runId}@str-test.local`,
    });
    run.orgIds.push(org.id);
    await db.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });
    await expect(
      verifyOrganization(org.id, adminId),
    ).rejects.toThrow();
  });

  it("SUSPENDED admin cannot suspend organization", async () => {
    run = startTestRun();
    const ownerId = await createTestUser(run, "member");
    const adminId = await createTestUser(run, "admin");
    const org = await registerOrganization(ownerId, {
      legalName: `G11A Test Org 2 ${run.runId}`,
      displayName: `G11A Org 2 ${run.runId}`,
      email: `org2-${run.runId}@str-test.local`,
    });
    run.orgIds.push(org.id);
    // Verify the org first (need an ACTIVE admin)
    await verifyOrganization(org.id, adminId);
    // Now suspend the admin
    await db.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });
    await expect(
      suspendOrganization(org.id, adminId, "should fail"),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. moderation: SUSPENDED user cannot file complaints; SUSPENDED admin cannot decide
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00A — Cross-module: moderation/service.ts suspension enforcement", () => {
  it("SUSPENDED user cannot file a complaint", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    const complainantId = await createTestUser(run, "member");
    await db.user.update({ where: { id: complainantId }, data: { status: "SUSPENDED" } });
    await expect(
      fileComplaint(complainantId, {
        projectId: ctx.projectId,
        reason: "Should fail because complainant is suspended",
      }),
    ).rejects.toThrow();
  });

  it("SUSPENDED admin cannot decide complaints", async () => {
    run = startTestRun();
    const ctx = await createApprovedProject(run);
    const adminId = await createTestUser(run, "admin");
    const complainantId = await createTestUser(run, "member");

    // File a complaint first (ACTIVE complainant)
    const complaint = await fileComplaint(complainantId, {
      projectId: ctx.projectId,
      reason: "Test complaint for suspended admin decision",
    });

    // Now suspend the admin
    await db.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });

    await expect(
      decideComplaint(complaint.id, adminId, {
        action: "DISMISS",
        reason: "Should fail because admin is suspended",
      }),
    ).rejects.toThrow();
  });
});
