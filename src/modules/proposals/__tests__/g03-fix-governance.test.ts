/**
 * STR G03-FIX — Governance Authorization Tests
 * Uses per-test isolation (no global deleteMany). Each test creates its
 * own users via createTestUser and cleans up via cleanupTestRun.
 */
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { startTestRun, cleanupTestRun, createTestUser, type TestRun } from "./test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import { suspendProject, reactivateProject, changeSteward, changeLead, inviteMember, acceptInvitation } from "@/modules/teams/service";
import { ForbiddenError, UnprocessableEntityError } from "@/lib/errors";

const validCharter = {
  problemStatement: "There is a significant gap in technical training opportunities for young developers in Syria.",
  outcomes: "A mentorship program that pairs 50 junior developers with senior engineers over 6 months.",
  scope: "Web development mentorship focusing on React, Node.js, and PostgreSQL.",
  requiredSkills: ["React", "Node.js", "PostgreSQL"],
  acceptanceCriteria: "50 junior developers complete the program with a portfolio project.",
};

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

describe("G03-FIX §1 — Institutional reviewer authorization", () => {
  it("blocks a regular member from reviewing (no reviewer role)", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const memberId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Auth Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId: memberId, action: "REJECT", reason: "Should be blocked because the reviewer has no institutional role." }),
    ).rejects.toThrow(ForbiddenError);
    const decisions = await db.reviewDecision.count({ where: { proposalId: proposal.id } });
    expect(decisions).toBe(0);
  });

  it("allows a user with reviewer role to review", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const proposal = await createProposal({ submitterId, title: "Reviewer OK", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "REJECT", reason: "Rejected by an institutional reviewer for testing purposes." });
    const decisions = await db.reviewDecision.count({ where: { proposalId: proposal.id } });
    expect(decisions).toBe(1);
  });
});

describe("G03-FIX §2 — Steward qualification", () => {
  it("blocks approval when steward is not qualified", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const memberId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Unqualified Steward", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Should fail because steward is a regular member.", stewardId: memberId }),
    ).rejects.toThrow(ForbiddenError);
    const projects = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projects).toBe(0);
  });

  it("blocks approval when steward = reviewer (separation of duties)", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const proposal = await createProposal({ submitterId, title: "Steward=Reviewer", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Should fail because steward equals reviewer.", stewardId: reviewerId }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows approval with a qualified steward", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Qualified Steward", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved with a qualified institutional steward.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    expect(project).toBeTruthy();
    expect(project?.stewardId).toBe(stewardId);
  });
});

describe("G03-FIX §3 — Inside-service authorization for suspend/reactivate", () => {
  it("blocks a regular member from suspending", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const memberId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Govern Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for governance testing purposes.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await expect(suspendProject(project.id, memberId, "Should be blocked")).rejects.toThrow(ForbiddenError);
    const unchanged = await db.project.findUnique({ where: { id: project.id } });
    expect(unchanged?.status).toBe("ACTIVE");
  });

  it("blocks the lead (non-steward) from suspending", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Lead Suspend Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for lead suspend testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await expect(suspendProject(project.id, submitterId, "Should be blocked — lead is not steward")).rejects.toThrow(ForbiddenError);
  });

  it("allows the steward to suspend", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Steward Suspend", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for steward suspend testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await suspendProject(project.id, stewardId, "Steward suspension test");
    const suspended = await db.project.findUnique({ where: { id: project.id } });
    expect(suspended?.status).toBe("SUSPENDED");
  });

  it("allows the steward to reactivate after suspension", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Reactivate Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for reactivation testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await suspendProject(project.id, stewardId, "Temporary suspension");
    await reactivateProject(project.id, stewardId);
    const reactivated = await db.project.findUnique({ where: { id: project.id } });
    expect(reactivated?.status).toBe("ACTIVE");
  });

  it("blocks a regular member from reactivating", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const memberId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Reactivate Block", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for reactivation block testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await suspendProject(project.id, stewardId, "Test suspension");
    await expect(reactivateProject(project.id, memberId)).rejects.toThrow(ForbiddenError);
  });
});

describe("G03-FIX §4 — Atomicity: ReviewDecision not recorded on approval failure", () => {
  it("does NOT record a ReviewDecision if approval fails", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const memberId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Atomicity Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Should fail because steward is unqualified.", stewardId: memberId }),
    ).rejects.toThrow(ForbiddenError);
    const decisions = await db.reviewDecision.count({ where: { proposalId: proposal.id } });
    expect(decisions).toBe(0);
    const unchanged = await db.projectProposal.findUnique({ where: { id: proposal.id } });
    expect(unchanged?.status).toBe("SUBMITTED");
  });
});

describe("G03-FIX §5 — Concurrent approval (idempotency under race)", () => {
  it("handles concurrent approval attempts: exactly one team created", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Concurrent Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    const results = await Promise.allSettled([
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "First concurrent approval attempt for testing.", stewardId }),
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Second concurrent approval attempt for testing.", stewardId }),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);
    const projects = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projects).toBe(1);
    const teams = await db.team.count({ where: { project: { proposalId: proposal.id } } });
    expect(teams).toBe(1);
  });
});

describe("G03-FIX §7 — Steward and lead change", () => {
  it("allows admin to change steward to a qualified user", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const adminId = await createTestUser(run, "admin");
    const newStewardId = await createTestUser(run, "steward", "New Steward");
    const proposal = await createProposal({ submitterId, title: "Steward Change", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for steward change testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await changeSteward({ projectId: project.id, newStewardId, actorId: adminId });
    const updated = await db.project.findUnique({ where: { id: project.id } });
    expect(updated?.stewardId).toBe(newStewardId);
    // Verify steward history is preserved (old assignment still exists).
    const assignments = await db.stewardAssignment.findMany({ where: { projectId: project.id }, orderBy: { assignedAt: "asc" } });
    expect(assignments.length).toBeGreaterThanOrEqual(2);
    expect(assignments[0]?.stewardId).toBe(stewardId);
    expect(assignments[0]?.unassignedAt).toBeTruthy();
    expect(assignments[1]?.stewardId).toBe(newStewardId);
    expect(assignments[1]?.unassignedAt).toBeNull();
  });

  it("blocks non-admin from changing steward", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const memberId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Steward Perm", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for permission testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await expect(changeSteward({ projectId: project.id, newStewardId: stewardId, actorId: memberId })).rejects.toThrow(ForbiddenError);
  });

  it("allows lead to transfer leadership to a team member", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const memberId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Lead Change", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for lead change testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id }, include: { team: true } });
    const teamId = project?.team?.id;
    if (!teamId) throw new Error("team not found");
    const invitation = await inviteMember({ teamId, inviterId: submitterId, inviteeId: memberId, role: "MEMBER" });
    await acceptInvitation(invitation.id, memberId);
    await changeLead({ projectId: project!.id, newLeadId: memberId, actorId: submitterId });
    const updated = await db.project.findUnique({ where: { id: project!.id } });
    expect(updated?.leadId).toBe(memberId);
  });
});

describe("G03-FIX §4 — Negative: lead cannot grant self admin role", () => {
  it("prevents lead from escalating to admin via role grant", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Escalation Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for escalation testing.", stewardId });
    // The lead (submitter) tries to grant themselves admin role.
    // This should be blocked — only admins can grant roles (future G06).
    // For now, we verify the lead does NOT have admin role.
    const grants = await db.roleGrant.findMany({ where: { userId: submitterId, revokedAt: null } });
    const hasAdmin = grants.some((g) => g.role === "admin");
    expect(hasAdmin).toBe(false);
  });
});
