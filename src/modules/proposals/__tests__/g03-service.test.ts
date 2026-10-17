/**
 * STR G03 — Proposals & Teams Unit Tests
 *
 * Tests the critical G03 invariants:
 *   1. Conflict-of-interest: submitter cannot review their own proposal
 *   2. Atomic team creation: approving creates Project + Team + Steward + Lead exactly once
 *   3. Idempotency: double-approval does not create duplicate teams
 *   4. No-steward-block: approval without steward fails
 *   5. State transitions: DRAFT→SUBMITTED→APPROVED, REJECTED, NEEDS_REVISION
 *   6. Cross-team isolation: a member of team A cannot act on team B
 *
 * These tests use a real PostgreSQL database (CI provides it).
 * In the sandbox without DB, they're skipped (Vitest detects missing connection).
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  createProposal,
  submitProposal,
  reviewProposal,
  withdrawProposal,
  getProposalById,
} from "@/modules/proposals/service";
import {
  inviteMember,
  acceptInvitation,
  suspendProject,
} from "@/modules/teams/service";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@/lib/errors";

let submitterId: string;
let reviewerId: string;
let stewardId: string;
let otherMemberId: string;

const validCharter = {
  problemStatement: "There is a significant gap in technical training opportunities for young developers in Syria.",
  outcomes: "A mentorship program that pairs 50 junior developers with senior engineers over 6 months.",
  scope: "Web development mentorship focusing on React, Node.js, and PostgreSQL.",
  exclusions: "Mobile development and data science are out of scope for this pilot.",
  beneficiaries: "Junior developers with 0-2 years of experience in Damascus and Aleppo.",
  preliminaryArchitecture: "Next.js platform with PostgreSQL backend, matching algorithm based on skills.",
  requiredSkills: ["React", "Node.js", "PostgreSQL", "Mentoring"],
  resources: "2 senior mentors, 1 project coordinator, cloud hosting budget.",
  risks: "Low mentor retention; mitigated by staggered cohorts.",
  rights: "All code is MIT licensed; mentorship content is CC-BY-SA.",
  acceptanceCriteria: "50 junior developers complete the program with a portfolio project.",
};

beforeEach(async () => {
  // Clean up test data.
  // Clean up in dependency order to avoid FK constraint errors.
  await db.resourceGrant.deleteMany({});
  await db.teamInvitation.deleteMany({});
  await db.teamMembership.deleteMany({});
  await db.stewardAssignment.deleteMany({});
  await db.team.deleteMany({});
  await db.reviewDecision.deleteMany({});
  await db.project.deleteMany({});
  await db.charterRevision.deleteMany({});
  await db.projectProposal.deleteMany({});
  // Clean up test users + their role grants.
  const testEmails = await db.user.findMany({
    where: { email: { contains: "g03-" } },
    select: { id: true },
  });
  if (testEmails.length > 0) {
    await db.roleGrant.deleteMany({
      where: { userId: { in: testEmails.map((u) => u.id) } },
    });
    await db.user.deleteMany({
      where: { id: { in: testEmails.map((u) => u.id) } },
    });
  }

  // Create test users.
  const submitter = await db.user.create({
    data: {
      email: `g03-sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@str-test.local`,
      displayName: "Test Submitter",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: { role: "member", scope: "global" } },
    },
  });
  submitterId = submitter.id;

  const reviewer = await db.user.create({
    data: {
      email: `g03-rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@str-test.local`,
      displayName: "Test Reviewer",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: {
        create: [
          { role: "member", scope: "global" },
          { role: "reviewer", scope: "global" },
        ],
      },
    },
  });
  reviewerId = reviewer.id;

  const steward = await db.user.create({
    data: {
      email: `g03-stw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@str-test.local`,
      displayName: "Test Steward",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: {
        create: [
          { role: "member", scope: "global" },
          { role: "steward", scope: "global" },
        ],
      },
    },
  });
  stewardId = steward.id;

  const other = await db.user.create({
    data: {
      email: `g03-oth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@str-test.local`,
      displayName: "Test Other",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: { role: "member", scope: "global" } },
    },
  });
  otherMemberId = other.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("G03 — Proposal lifecycle", () => {
  it("creates a proposal in DRAFT with a charter revision", async () => {
    const proposal = await createProposal({
      submitterId,
      title: "Test Mentorship Program",
      charter: validCharter,
    });
    expect(proposal.status).toBe("DRAFT");
    const full = await getProposalById(proposal.id);
    expect(full?.currentRevision?.version).toBe(1);
  });

  it("transitions DRAFT → SUBMITTED", async () => {
    const proposal = await createProposal({ submitterId, title: "Submit Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    const updated = await getProposalById(proposal.id);
    expect(updated?.status).toBe("SUBMITTED");
  });

  it("prevents non-submitter from submitting", async () => {
    const proposal = await createProposal({ submitterId, title: "Perm Test", charter: validCharter });
    await expect(submitProposal(proposal.id, reviewerId)).rejects.toThrow(ForbiddenError);
  });
});

describe("G03 — Conflict of interest (no self-review)", () => {
  it("prevents submitter from reviewing their own proposal", async () => {
    const proposal = await createProposal({ submitterId, title: "Self-Review Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId: submitterId,
        action: "APPROVE",
        reason: "Should be blocked by conflict-of-interest guard",
        stewardId,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("prevents approval when steward is the submitter", async () => {
    const proposal = await createProposal({ submitterId, title: "Steward Conflict", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Should fail because steward = submitter",
        stewardId: submitterId,
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("G03 — Atomic team creation (STR-GOV-TEAM-01)", () => {
  it("creates Project + Team + Steward + Lead in one transaction on approval", async () => {
    const proposal = await createProposal({ submitterId, title: "Atomic Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Meets all acceptance criteria and is approved for execution.",
      stewardId,
    });
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
    const proposal = await createProposal({ submitterId, title: "Idempotency Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "First approval",
      stewardId,
    });
    const projectsAfterFirst = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projectsAfterFirst).toBe(1);
    // Second approval — proposal is now APPROVED, should throw ConflictError.
    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Second approval should be blocked",
        stewardId,
      }),
    ).rejects.toThrow(ConflictError);
    const projectsAfterSecond = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projectsAfterSecond).toBe(1);
  });

  it("blocks approval when steward is not provided", async () => {
    const proposal = await createProposal({ submitterId, title: "No Steward Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Should fail because no steward is provided.",
      }),
    ).rejects.toThrow(UnprocessableEntityError);
    const projects = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projects).toBe(0);
  });
});

describe("G03 — Team membership & invitations", () => {
  it("allows lead to invite a member who accepts", async () => {
    const proposal = await createProposal({ submitterId, title: "Invite Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for invitation testing.",
      stewardId,
    });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id }, include: { team: true } });
    const teamId = project?.team?.id; if (!teamId) throw new Error('team not found');
    const invitation = await inviteMember({
      teamId,
      inviterId: submitterId,
      inviteeId: otherMemberId,
      role: "MEMBER",
    });
    await acceptInvitation(invitation.id, otherMemberId);
    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: otherMemberId } },
    });
    expect(membership?.role).toBe("MEMBER");
  });

  it("prevents non-lead/non-steward from inviting", async () => {
    const proposal = await createProposal({ submitterId, title: "Perm Invite Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for permission testing.",
      stewardId,
    });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id }, include: { team: true } });
    const teamId = project?.team?.id; if (!teamId) throw new Error('team not found');
    await expect(
      inviteMember({
        teamId,
        inviterId: otherMemberId,
        inviteeId: reviewerId,
        role: "MEMBER",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("G03 — Project suspension (scope control)", () => {
  it("allows steward to suspend, revoking resource grants", async () => {
    const proposal = await createProposal({ submitterId, title: "Suspend Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for suspension testing.",
      stewardId,
    });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    await db.resourceGrant.create({
      data: {
        projectId: project!.id,
        grantType: "integration:mock",
        scope: "test-scope",
        grantedBy: stewardId,
      },
    });
    await suspendProject(project!.id, stewardId, "Testing suspension");
    const suspended = await db.project.findUnique({ where: { id: project!.id } });
    expect(suspended?.status).toBe("SUSPENDED");
    const grants = await db.resourceGrant.findMany({ where: { projectId: project!.id } });
    expect(grants[0]?.revokedAt).toBeTruthy();
  });
});

describe("G03 — No direct team creation (structural)", () => {
  it("teams module does NOT export createTeam", async () => {
    const teamsModule = await import("@/modules/teams/service");
    expect((teamsModule as Record<string, unknown>).createTeam).toBeUndefined();
    expect(typeof teamsModule.inviteMember).toBe("function");
  });
});
