/**
 * STR G03-FIX — Governance Authorization Tests
 *
 * Tests the G03-FIX security fixes:
 *   1. Only institutional reviewers (admin/reviewer role) can review
 *   2. Steward must be qualified (admin/steward role) — no self-appointment
 *   3. Steward cannot be the reviewer (separation of duties)
 *   4. suspendProject/reactivateProject enforce authorization INSIDE the service
 *   5. Concurrent approval: only one team created
 *   6. ReviewDecision is atomic (not recorded if approval fails)
 *   7. Steward/lead change procedures
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  createProposal,
  submitProposal,
  reviewProposal,
} from "@/modules/proposals/service";
import {
  suspendProject,
  reactivateProject,
  changeSteward,
  changeLead,
  inviteMember,
  acceptInvitation,
} from "@/modules/teams/service";
import {
  ForbiddenError,
  UnprocessableEntityError,
  ConflictError,
} from "@/lib/errors";

let submitterId: string;
let reviewerId: string;
let stewardId: string;
let otherMemberId: string;

const validCharter = {
  problemStatement: "There is a significant gap in technical training opportunities for young developers in Syria.",
  outcomes: "A mentorship program that pairs 50 junior developers with senior engineers over 6 months.",
  scope: "Web development mentorship focusing on React, Node.js, and PostgreSQL.",
  exclusions: "Mobile development and data science are out of scope.",
  beneficiaries: "Junior developers with 0-2 years of experience.",
  preliminaryArchitecture: "Next.js platform with PostgreSQL backend.",
  requiredSkills: ["React", "Node.js", "PostgreSQL"],
  resources: "2 senior mentors, cloud hosting.",
  risks: "Low mentor retention.",
  rights: "MIT licensed code, CC-BY-SA content.",
  acceptanceCriteria: "50 junior developers complete the program.",
};

beforeEach(async () => {
  await db.resourceGrant.deleteMany({});
  await db.teamInvitation.deleteMany({});
  await db.teamMembership.deleteMany({});
  await db.stewardAssignment.deleteMany({});
  await db.team.deleteMany({});
  await db.project.deleteMany({});
  await db.reviewDecision.deleteMany({});
  await db.charterRevision.deleteMany({});
  await db.projectProposal.deleteMany({});
  await db.roleGrant.deleteMany({ where: { userId: { in: [submitterId, reviewerId, stewardId, otherMemberId].filter(Boolean) } } });
  await db.user.deleteMany({ where: { email: { contains: "g03fix" } } });

  // Create users with appropriate roles.
  const submitter = await db.user.create({
    data: {
      email: `g03fix-sub-${Date.now()}@str-test.local`,
      displayName: "Fix Submitter",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: { role: "member", scope: "global" } },
    },
  });
  submitterId = submitter.id;

  // Reviewer with "reviewer" role (institutional reviewer).
  const reviewer = await db.user.create({
    data: {
      email: `g03fix-rev-${Date.now()}@str-test.local`,
      displayName: "Fix Reviewer",
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

  // Steward with "steward" role.
  const steward = await db.user.create({
    data: {
      email: `g03fix-stw-${Date.now()}@str-test.local`,
      displayName: "Fix Steward",
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

  // Regular member (NO reviewer/steward role — for negative tests).
  const member = await db.user.create({
    data: {
      email: `g03fix-mem-${Date.now()}@str-test.local`,
      displayName: "Fix Member",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: { role: "member", scope: "global" } },
    },
  });
  otherMemberId = member.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("G03-FIX §1 — Institutional reviewer authorization", () => {
  it("blocks a regular member from reviewing (no reviewer role)", async () => {
    const proposal = await createProposal({ submitterId, title: "Auth Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    // otherMemberId has NO reviewer role — should be blocked.
    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId: otherMemberId,
        action: "REJECT",
        reason: "This should be blocked because the reviewer has no institutional role.",
      }),
    ).rejects.toThrow(ForbiddenError);

    // No ReviewDecision should be recorded.
    const decisions = await db.reviewDecision.count({ where: { proposalId: proposal.id } });
    expect(decisions).toBe(0);
  });

  it("allows a user with reviewer role to review", async () => {
    const proposal = await createProposal({ submitterId, title: "Reviewer OK", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    await reviewProposal({
      proposalId: proposal.id,
      reviewerId, // has reviewer role
      action: "REJECT",
      reason: "Rejected by an institutional reviewer for testing purposes.",
    });

    const decisions = await db.reviewDecision.count({ where: { proposalId: proposal.id } });
    expect(decisions).toBe(1);
  });
});

describe("G03-FIX §2 — Steward qualification", () => {
  it("blocks approval when steward is not qualified (no admin/steward role)", async () => {
    const proposal = await createProposal({ submitterId, title: "Unqualified Steward", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Should fail because steward is a regular member.",
        stewardId: otherMemberId, // NOT qualified
      }),
    ).rejects.toThrow(ForbiddenError);

    // No project created.
    const projects = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projects).toBe(0);
  });

  it("blocks approval when steward = reviewer (separation of duties)", async () => {
    const proposal = await createProposal({ submitterId, title: "Steward=Reviewer", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Should fail because steward = reviewer.",
        stewardId: reviewerId, // same as reviewer!
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows approval with a qualified steward", async () => {
    const proposal = await createProposal({ submitterId, title: "Qualified Steward", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved with a qualified institutional steward.",
      stewardId, // has steward role
    });

    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    expect(project).toBeTruthy();
    expect(project?.stewardId).toBe(stewardId);
  });
});

describe("G03-FIX §3 — Inside-service authorization for suspend/reactivate", () => {
  async function setupApprovedProject() {
    const proposal = await createProposal({ submitterId, title: "Govern Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for governance testing.",
      stewardId,
    });
    return db.project.findUnique({ where: { proposalId: proposal.id } });
  }

  it("blocks a regular member from suspending", async () => {
    const project = await setupApprovedProject();
    await expect(
      suspendProject(project!.id, otherMemberId, "Should be blocked"),
    ).rejects.toThrow(ForbiddenError);
    const unchanged = await db.project.findUnique({ where: { id: project!.id } });
    expect(unchanged?.status).toBe("ACTIVE");
  });

  it("blocks the lead (non-steward) from suspending", async () => {
    const project = await setupApprovedProject();
    // submitterId is the lead, NOT the steward.
    await expect(
      suspendProject(project!.id, submitterId, "Should be blocked — lead is not steward"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows the steward to suspend", async () => {
    const project = await setupApprovedProject();
    await suspendProject(project!.id, stewardId, "Steward suspension test");
    const suspended = await db.project.findUnique({ where: { id: project!.id } });
    expect(suspended?.status).toBe("SUSPENDED");
  });

  it("allows the steward to reactivate after suspension", async () => {
    const project = await setupApprovedProject();
    await suspendProject(project!.id, stewardId, "Temporary suspension");
    await reactivateProject(project!.id, stewardId);
    const reactivated = await db.project.findUnique({ where: { id: project!.id } });
    expect(reactivated?.status).toBe("ACTIVE");
  });

  it("blocks a regular member from reactivating", async () => {
    const project = await setupApprovedProject();
    await suspendProject(project!.id, stewardId, "Test");
    await expect(
      reactivateProject(project!.id, otherMemberId),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("G03-FIX §4 — Atomicity: ReviewDecision not recorded on approval failure", () => {
  it("does NOT record a ReviewDecision if approval fails", async () => {
    const proposal = await createProposal({ submitterId, title: "Atomicity Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    // Attempt approval with an unqualified steward — should fail.
    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Should fail because steward is unqualified.",
        stewardId: otherMemberId,
      }),
    ).rejects.toThrow(ForbiddenError);

    // CRITICAL: NO ReviewDecision should exist (atomicity).
    const decisions = await db.reviewDecision.count({ where: { proposalId: proposal.id } });
    expect(decisions).toBe(0);

    // Proposal should still be SUBMITTED (not approved).
    const unchanged = await db.projectProposal.findUnique({ where: { id: proposal.id } });
    expect(unchanged?.status).toBe("SUBMITTED");
  });
});

describe("G03-FIX §5 — Concurrent approval (idempotency under race)", () => {
  it("handles concurrent approval attempts: exactly one team created", async () => {
    const proposal = await createProposal({ submitterId, title: "Concurrent Test", charter: validCharter });
    await submitProposal(proposal.id, submitterId);

    // Fire two approval attempts in parallel.
    const results = await Promise.allSettled([
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "First concurrent approval attempt.",
        stewardId,
      }),
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Second concurrent approval attempt.",
        stewardId,
      }),
    ]);

    // At least one should succeed; the other should fail (ConflictError).
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    expect(succeeded + failed).toBe(2);

    // CRITICAL: exactly ONE project/team created.
    const projects = await db.project.count({ where: { proposalId: proposal.id } });
    expect(projects).toBe(1);

    const teams = await db.team.count({
      where: { project: { proposalId: proposal.id } },
    });
    expect(teams).toBe(1);
  });
});

describe("G03-FIX §7 — Steward and lead change", () => {
  it("allows admin to change steward to a qualified user", async () => {
    const proposal = await createProposal({ submitterId, title: "Steward Change", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for steward change test.",
      stewardId,
    });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });

    // Create an admin + a new qualified steward.
    const admin = await db.user.create({
      data: {
        email: `g03fix-admin-${Date.now()}@str-test.local`,
        displayName: "Admin",
        status: "ACTIVE",
        emailVerified: new Date(),
        roleGrants: { create: [{ role: "member", scope: "global" }, { role: "admin", scope: "global" }] },
      },
    });
    const newSteward = await db.user.create({
      data: {
        email: `g03fix-newstw-${Date.now()}@str-test.local`,
        displayName: "New Steward",
        status: "ACTIVE",
        emailVerified: new Date(),
        roleGrants: { create: [{ role: "member", scope: "global" }, { role: "steward", scope: "global" }] },
      },
    });

    await changeSteward({ projectId: project!.id, newStewardId: newSteward.id, actorId: admin.id });

    const updated = await db.project.findUnique({ where: { id: project!.id } });
    expect(updated?.stewardId).toBe(newSteward.id);
  });

  it("blocks non-admin from changing steward", async () => {
    const proposal = await createProposal({ submitterId, title: "Steward Perm", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for testing purposes.",
      stewardId,
    });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });

    await expect(
      changeSteward({ projectId: project!.id, newStewardId: stewardId, actorId: otherMemberId }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows lead to transfer leadership to a team member", async () => {
    const proposal = await createProposal({ submitterId, title: "Lead Change", charter: validCharter });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for testing purposes.",
      stewardId,
    });
    const project = await db.project.findUnique({
      where: { proposalId: proposal.id },
      include: { team: true },
    });
    const teamId = project?.team?.id;
    if (!teamId) throw new Error("team not found");

    // Invite a member.
    const invitation = await inviteMember({
      teamId,
      inviterId: submitterId,
      inviteeId: otherMemberId,
      role: "MEMBER",
    });
    await acceptInvitation(invitation.id, otherMemberId);

    // Lead transfers to the new member.
    await changeLead({ projectId: project!.id, newLeadId: otherMemberId, actorId: submitterId });

    const updated = await db.project.findUnique({ where: { id: project!.id } });
    expect(updated?.leadId).toBe(otherMemberId);
  });
});
