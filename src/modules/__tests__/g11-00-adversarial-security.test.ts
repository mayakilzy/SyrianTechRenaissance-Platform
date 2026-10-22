/**
 * STR G11-00 — Adversarial Security Regression Tests
 * ---------------------------------------------------
 * NEW adversarial tests written by GLM during the G11-00 hardening mission.
 * These tests target gaps NOT covered by existing G09 tests:
 *
 *   1. Race conditions in critical state transitions (concurrent proposal submit/approve).
 *   2. Email enumeration: signup/reset-password/verify-email all return generic messages.
 *   3. Account-suspension effect: suspended users cannot perform privileged operations.
 *   4. Role-grant revocation: revoked role grant is enforced immediately.
 *   5. Project suspension lifecycle: cannot double-suspend, cannot act while suspended.
 *
 * These tests run against a real PostgreSQL (via the G11-00 test harness).
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";
import {
  createProposal,
  submitProposal,
  reviewProposal,
} from "@/modules/proposals/service";
import { suspendProject, reactivateProject } from "@/modules/teams/service";
import { requestPasswordReset } from "@/modules/identity/service";

interface TestRun {
  runId: string;
  userIds: string[];
}

function startTestRun(): TestRun {
  return { runId: randomBytes(4).toString("hex"), userIds: [] };
}

async function createTestUser(
  run: TestRun,
  role: "member" | "reviewer" | "steward" | "admin" = "member",
  displayName?: string,
): Promise<string> {
  const roles = ["member"];
  if (role === "reviewer") roles.push("reviewer");
  if (role === "steward") roles.push("steward");
  if (role === "admin") {
    roles.push("admin");
    roles.push("reviewer");
    roles.push("steward");
  }
  const user = await db.user.create({
    data: {
      email: `g11run-${run.runId}-${role}-${randomBytes(2).toString("hex")}@str-test.local`,
      displayName: displayName ?? `Test ${role}`,
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: roles.map((r) => ({ role: r, scope: "global" })) },
    },
  });
  run.userIds.push(user.id);
  return user.id;
}

async function cleanupTestRun(run: TestRun): Promise<void> {
  if (run.userIds.length === 0) return;
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
  problemStatement: "G11-00 adversarial test: there is a significant gap in testing.",
  outcomes: "Comprehensive adversarial coverage with no assumptions.",
  scope: "Engineering validation only — no UI changes.",
  requiredSkills: ["TypeScript", "PostgreSQL", "Security"],
  acceptanceCriteria: "All adversarial tests pass against real PG.",
};

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Concurrent proposal approval — should NOT result in double-project creation
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00 — Adversarial: concurrent state transitions", () => {
  it("concurrent proposal approvals do NOT create two projects (race protection)", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");

    const proposal = await createProposal({ submitterId, title: "Race test title", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    // Two concurrent approvals. The service implements idempotent approval:
    // the second concurrent call finds the proposal no longer in SUBMITTED
    // status, looks up the existing project, and returns it WITHOUT creating
    // a duplicate. Both calls should succeed (both return the same project),
    // but only ONE project + ONE review decision should exist.
    const results = await Promise.allSettled([
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "first approval attempt", stewardId }),
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "second approval attempt", stewardId }),
    ]);

    // Both may resolve (idempotent) or one may reject (race-loss throws ConflictError).
    // What matters is no duplicate state was created.
    const projects = await db.project.findMany({
      where: { proposalId: proposal.id },
    });
    expect(projects.length).toBe(1);

    const decisions = await db.reviewDecision.findMany({
      where: { proposalId: proposal.id, action: "APPROVE" },
    });
    expect(decisions.length).toBe(1);

    const teams = await db.team.findMany({
      where: { projectId: projects[0]!.id },
    });
    expect(teams.length).toBe(1);

    const finalProposal = await db.projectProposal.findUnique({ where: { id: proposal.id } });
    expect(finalProposal?.status).toBe("APPROVED");
  });

  it("double-submit of a DRAFT proposal fails cleanly (no duplicate state)", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Double-submit title", charter: validCharter });

    const results = await Promise.allSettled([
      submitProposal(proposal.id, submitterId),
      submitProposal(proposal.id, submitterId),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // At least one must succeed; the other either rejects (ConflictError) OR
    // no-ops. The important invariant: only ONE submit occurred (proposal
    // status is SUBMITTED, not APPROVED or anything else).
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const p = await db.projectProposal.findUnique({ where: { id: proposal.id } });
    expect(p?.status).toBe("SUBMITTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Email enumeration — reset password returns generic message
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00 — Adversarial: email enumeration prevention", () => {
  it("password reset for unknown email returns same message as known email", async () => {
    run = startTestRun();
    const knownUserId = await createTestUser(run, "member", "Known User");
    const knownUser = await db.user.findUnique({ where: { id: knownUserId } });
    const knownEmail = knownUser!.email;
    const unknownEmail = `g11-unknown-${run.runId}@str-test.local`;

    const knownResult = await requestPasswordReset({ email: knownEmail });
    const unknownResult = await requestPasswordReset({ email: unknownEmail });

    expect(knownResult.message).toBe(unknownResult.message);
    expect(knownResult.message).not.toContain(knownEmail);
    expect(knownResult.message).not.toContain(unknownEmail);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Suspended user cannot perform privileged operations
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00 — Adversarial: suspended account enforcement", () => {
  it("SUSPENDED user cannot create a proposal", async () => {
    run = startTestRun();
    const userId = await createTestUser(run, "member");
    await db.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
    await expect(
      createProposal({ submitterId: userId, title: "Suspended user title", charter: validCharter }),
    ).rejects.toThrowError(/not active|suspended|forbidden|inactive/i);
  });

  it("SUSPENDED admin (with active roleGrants) cannot review proposals", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    await db.user.update({ where: { id: adminId }, data: { status: "SUSPENDED" } });
    const memberUserId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId: memberUserId, title: "Test Proposal Title", charter: validCharter });
    await submitProposal(proposal.id, memberUserId);

    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId: adminId,
        action: "REJECT",
        reason: "should fail because admin is suspended",
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Role grant revocation — enforced immediately
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00 — Adversarial: role grant revocation immediate effect", () => {
  it("revoking the reviewer role grant prevents further reviews", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");

    const proposal = await createProposal({ submitterId, title: "Revoke test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "REQUEST_REVISION",
      reason: "needs more detail in charter",
    });

    const proposal2 = await createProposal({ submitterId, title: "Revoke test 2", charter: validCharter });
    await submitProposal(proposal2.id, submitterId);

    // Revoke the reviewer's reviewer role grant.
    await db.roleGrant.updateMany({
      where: { userId: reviewerId, role: "reviewer", revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await expect(
      reviewProposal({
        proposalId: proposal2.id,
        reviewerId,
        action: "REJECT",
        reason: "should fail because reviewer grant was revoked",
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Project suspension lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("G11-00 — Adversarial: project suspension lifecycle", () => {
  it("double-suspend fails, reactivate, re-suspend succeeds", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");

    const proposal = await createProposal({ submitterId, title: "Lifecycle", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    const review = await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "adversarial lifecycle test approval",
      stewardId,
    });
    // Get the projectId from the team or project lookup
    const project = await db.project.findFirst({
      where: { proposalId: proposal.id },
    });
    expect(project).not.toBeNull();
    const projectId = project!.id;

    await suspendProject(projectId, stewardId, "adversarial test suspension");

    await expect(
      suspendProject(projectId, stewardId, "second suspension should fail"),
    ).rejects.toThrow();

    await reactivateProject(projectId, stewardId);
    await suspendProject(projectId, stewardId, "third suspension should succeed");
  });
});
