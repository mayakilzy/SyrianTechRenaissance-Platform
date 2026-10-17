/**
 * STR G03 — Proposal & Team Governance Tests
 * Uses per-test isolation (no global deleteMany). Each test creates its
 * own users via createTestUser and cleans up via cleanupTestRun.
 */
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { startTestRun, cleanupTestRun, createTestUser, type TestRun } from "./test-isolation";
import {
  createProposal,
  submitProposal,
  reviewProposal,
  withdrawProposal,
  getProposalById,
} from "@/modules/proposals/service";
import { inviteMember, acceptInvitation, suspendProject } from "@/modules/teams/service";
import { ForbiddenError, ConflictError, UnprocessableEntityError } from "@/lib/errors";

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

describe("G03 — Proposal lifecycle", () => {
  it("creates a proposal in DRAFT with a charter revision", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Test Program", charter: validCharter });
    expect(proposal.status).toBe("DRAFT");
    const full = await getProposalById(proposal.id);
    expect(full?.currentRevision?.version).toBe(1);
  });

  it("transitions DRAFT to SUBMITTED", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Submit Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    const updated = await getProposalById(proposal.id);
    expect(updated?.status).toBe("SUBMITTED");
  });

  it("prevents non-submitter from submitting", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const otherId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Perm Test", charter: validCharter });
    await expect(submitProposal(proposal.id, otherId)).rejects.toThrow(ForbiddenError);
  });

  it("allows withdrawal from DRAFT", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Withdraw Test", charter: validCharter });
    await withdrawProposal(proposal.id, submitterId);
    const updated = await getProposalById(proposal.id);
    expect(updated?.status).toBe("WITHDRAWN");
  });
});

describe("G03 — Conflict of interest (no self-review)", () => {
  it("prevents submitter from reviewing their own proposal", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Self-Review Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId: submitterId, action: "REJECT", reason: "Should be blocked by conflict-of-interest guard", stewardId: submitterId }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("prevents approval when steward is the submitter", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const proposal = await createProposal({ submitterId, title: "Steward Conflict", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Should fail because steward = submitter", stewardId: submitterId }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("G03 — Atomic team creation (STR-GOV-TEAM-01)", () => {
  it("creates Project + Team + Steward + Lead in one transaction", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Atomic Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Meets all acceptance criteria and is approved for execution.", stewardId });
    const updated = await getProposalById(proposal.id);
    expect(updated?.status).toBe("APPROVED");
    expect(updated?.project).toBeTruthy();
    expect(updated?.project?.team).toBeTruthy();
    expect(updated?.project?.stewardId).toBe(stewardId);
    expect(updated?.project?.leadId).toBe(submitterId);
    expect(updated?.project?.team?.memberships.length).toBe(1);
    expect(updated?.project?.team?.memberships[0]?.role).toBe("LEAD");
  });

  it("is idempotent — double-approval does not create duplicate teams", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Idempotency Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "First approval for testing purposes.", stewardId });
    const projectsAfterFirst = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projectsAfterFirst).toBe(1);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Second approval should be blocked.", stewardId }),
    ).rejects.toThrow(ConflictError);
    const projectsAfterSecond = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projectsAfterSecond).toBe(1);
  });

  it("blocks approval when steward is not provided", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const proposal = await createProposal({ submitterId, title: "No Steward Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Should fail because no steward is provided." }),
    ).rejects.toThrow(UnprocessableEntityError);
    const projects = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projects).toBe(0);
  });
});

describe("G03 — Team membership & invitations", () => {
  it("allows lead to invite a member who accepts", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const inviteeId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Invite Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for invitation testing purposes.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id }, include: { team: true } });
    const teamId = project?.team?.id;
    if (!teamId) throw new Error("team not found");
    const invitation = await inviteMember({ teamId, inviterId: submitterId, inviteeId, role: "MEMBER" });
    await acceptInvitation(invitation.id, inviteeId);
    const membership = await db.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId: inviteeId } } });
    expect(membership?.role).toBe("MEMBER");
  });

  it("prevents non-lead/non-steward from inviting", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const otherId = await createTestUser(run, "member");
    const proposal = await createProposal({ submitterId, title: "Perm Invite Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for permission testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id }, include: { team: true } });
    const teamId = project?.team?.id;
    if (!teamId) throw new Error("team not found");
    await expect(
      inviteMember({ teamId, inviterId: otherId, inviteeId: reviewerId, role: "MEMBER" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("G03 — Project suspension (scope control)", () => {
  it("allows steward to suspend, revoking resource grants", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({ submitterId, title: "Suspend Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({ proposalId: proposal.id, reviewerId, action: "APPROVE", reason: "Approved for suspension testing.", stewardId });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("project not found");
    await db.resourceGrant.create({ data: { projectId: project.id, grantType: "integration:mock", scope: "test", grantedBy: stewardId } });
    await suspendProject(project.id, stewardId, "Testing suspension workflow");
    const suspended = await db.project.findUnique({ where: { id: project.id } });
    expect(suspended?.status).toBe("SUSPENDED");
    const grants = await db.resourceGrant.findMany({ where: { projectId: project.id } });
    expect(grants[0]?.revokedAt).toBeTruthy();
  });
});

describe("G03 — No direct team creation (structural)", () => {
  it("teams module does NOT export createTeam", async () => {
    const teamsModule = await import("@/modules/teams/service");
    expect((teamsModule as Record<string, unknown>).createTeam).toBeUndefined();
  });
});
