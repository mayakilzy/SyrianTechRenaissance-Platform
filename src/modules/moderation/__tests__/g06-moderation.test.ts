/**
 * STR G06-B — Moderation Unit Tests
 *
 * Tests critical G06 invariants:
 *   1. Anyone can file a complaint (with valid target)
 *   2. Moderator can decide WARNING/CONTENT_REMOVED/DISMISS/ESCALATE
 *   3. Moderator CANNOT decide USER_SUSPENDED (only admin)
 *   4. Admin can decide USER_SUSPENDED
 *   5. Anti-self-suspension: admin cannot suspend own account
 *   6. CONTENT_REMOVED does NOT delete the original (preserved for audit)
 *   7. USER_SUSPENDED actually sets User.status=SUSPENDED + audit event
 *   8. Atomic status transitions (optimistic lock)
 *   9. Cross-user visibility: complainant + target + admin/mod can see; others NotFound
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
} from "@/modules/organizations/__tests__/test-isolation";
import {
  fileComplaint,
  getComplaint,
  decideComplaint,
  listComplaints,
} from "@/modules/moderation/service";
import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

let run: ReturnType<typeof startTestRun>;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

describe("G06-B — File a complaint", () => {
  it("any user can file a complaint against another user", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "User posted inappropriate content in a project thread — complaint with sufficient length.",
    });
    expect(complaint.status).toBe("SUBMITTED");
  });

  it("prevents filing a complaint against yourself", async () => {
    run = startTestRun();
    const memberId = await createTestUser(run, "member");
    await expect(
      fileComplaint(memberId, {
        targetUserId: memberId,
        reason: "Self-complaint should be blocked.",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("requires at least one of projectId/threadId/targetUserId", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    await expect(
      fileComplaint(complainantId, {
        reason: "Complaint with no target — should fail.",
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("G06-B — Moderator role enforcement", () => {
  it("moderator can decide WARNING", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const modId = await createTestUser(run, "moderator");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Inappropriate comment in project thread — sufficient length for validation.",
    });
    const result = await decideComplaint(complaint.id, modId, {
      action: "WARNING",
      reason: "First warning — please refrain from this behavior in the future.",
    });
    expect(result.newStatus).toBe("RESOLVED_WARNING");
  });

  it("moderator can ESCALATE (escalation queue)", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const modId = await createTestUser(run, "moderator");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Severe violation — moderator escalates to admin for potential suspension.",
    });
    const result = await decideComplaint(complaint.id, modId, {
      action: "ESCALATE",
      reason: "Escalating due to severity of the violation — requires admin review.",
    });
    expect(result.newStatus).toBe("ESCALATED");
  });

  it("moderator CANNOT decide USER_SUSPENDED (admin only)", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const modId = await createTestUser(run, "moderator");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Repeated severe violations — needs user suspension.",
    });
    await expect(
      decideComplaint(complaint.id, modId, {
        action: "USER_SUSPENDED",
        reason: "Trying to suspend as moderator — should be blocked.",
      }),
    ).rejects.toThrow(ForbiddenError);
    // Verify target is still ACTIVE
    const target = await db.user.findUnique({ where: { id: targetId } });
    expect(target?.status).toBe("ACTIVE");
  });
});

describe("G06-B — Admin USER_SUSPENDED (anti-self-suspension)", () => {
  it("admin can suspend a user (atomic with audit event) — status is RESOLVED_SUSPENDED (not ESCALATED)", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const adminId = await createTestUser(run, "admin");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Severe violation requiring account suspension — sufficient length for validation.",
    });
    const result = await decideComplaint(complaint.id, adminId, {
      action: "USER_SUSPENDED",
      reason: "Account suspended due to severe and repeated violations of community standards.",
    });
    // USER_SUSPENDED → RESOLVED_SUSPENDED (terminal status, NOT ESCALATED)
    expect(result.newStatus).toBe("RESOLVED_SUSPENDED");
    // Verify user is actually suspended
    const target = await db.user.findUnique({ where: { id: targetId } });
    expect(target?.status).toBe("SUSPENDED");
    // Verify audit event recorded
    const audit = await db.auditEvent.findFirst({
      where: { action: "moderation.user_suspended", targetId: complaint.id },
    });
    expect(audit).toBeTruthy();
    // CRITICAL: the complaint is NOT in the open escalation queue
    const fetched = await db.moderationComplaint.findUnique({ where: { id: complaint.id } });
    expect(fetched?.status).toBe("RESOLVED_SUSPENDED");
    expect(fetched?.status).not.toBe("ESCALATED");
    expect(fetched?.decidedAt).toBeTruthy();
  });

  it("USER_SUSPENDED complaint does NOT appear in the open escalation queue", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const adminId = await createTestUser(run, "admin");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Complaint that should be fully resolved after suspension, not left in escalation queue.",
    });
    await decideComplaint(complaint.id, adminId, {
      action: "USER_SUSPENDED",
      reason: "Suspended — the complaint should now be in a terminal status, not escalation.",
    });
    // List all complaints with status ESCALATED — this one should NOT be there
    const escalated = await db.moderationComplaint.findMany({
      where: { status: "ESCALATED" },
    });
    const isThisComplaintEscalated = escalated.some((c) => c.id === complaint.id);
    expect(isThisComplaintEscalated).toBe(false);
    // But it IS in RESOLVED_SUSPENDED
    const resolved = await db.moderationComplaint.findMany({
      where: { status: "RESOLVED_SUSPENDED" },
    });
    const isThisComplaintResolved = resolved.some((c) => c.id === complaint.id);
    expect(isThisComplaintResolved).toBe(true);
  });

  it("prevents admin from suspending their own account", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const adminId = await createTestUser(run, "admin");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: adminId,
      reason: "Complaint against the admin themselves — should not allow self-suspension.",
    });
    await expect(
      decideComplaint(complaint.id, adminId, {
        action: "USER_SUSPENDED",
        reason: "Admin trying to suspend their own account — should be blocked.",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("G06-B — CONTENT_REMOVED preserves original (no deletion)", () => {
  it("CONTENT_REMOVED sets removedAt on target message + hides from regular users", async () => {
    run = startTestRun();
    // Setup: create a project + thread + message (the offending content)
    const adminId = await createTestUser(run, "admin");
    const stewardId = await createTestUser(run, "admin"); // separate steward (G03 requires stewardId !== reviewerId)
    const leadId = await createTestUser(run, "rep"); // project lead
    const memberId = await createTestUser(run, "member"); // regular member
    const modId = await createTestUser(run, "moderator"); // moderator

    // Create proposal + project via G03 service
    const { createProposal, submitProposal, reviewProposal } = await import("@/modules/proposals/service");
    const proposal = await createProposal({
      submitterId: leadId,
      title: `G06 Content Removal Test ${run.runId}`,
      charter: {
        problemStatement: "Test problem statement with sufficient length for validation purposes here.",
        outcomes: "Test outcomes with sufficient length for validation purposes here.",
        scope: "Test scope with sufficient length for validation purposes here.",
        requiredSkills: ["TypeScript"],
        acceptanceCriteria: "Test acceptance criteria with sufficient length for validation.",
      },
    });
    await submitProposal(proposal.id, leadId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId: adminId,
      action: "APPROVE",
      reason: "Approved for content removal test.",
      stewardId: stewardId, // separate steward (separation of duties)
    });
    const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
    if (!project) throw new Error("Project not created");
    run.proposalIds.push(proposal.id);
    run.projectIds.push(project.id);

    // Add member to the team (robust: create team if missing, then add membership)
    let team = await db.team.findFirst({ where: { projectId: project.id } });
    if (!team) {
      team = await db.team.create({ data: { projectId: project.id, name: `Team ${run.runId}` } });
    }
    await db.teamMembership.create({
      data: { teamId: team.id, userId: memberId, role: "MEMBER" },
    }).catch(() => {}); // ignore if already exists

    // Create a thread + message (the offending content)
    const { createThread, getThread, postMessage } = await import("@/modules/communications/threads");
    const thread = await createThread(project.id, leadId, {
      title: "Thread with offending message",
      initialMessage: "Initial message in the thread.",
    });
    const offendingMessage = await postMessage(thread.id, memberId, {
      body: "This is the offensive content that should be removed from view.",
    });

    // File a complaint targeting the specific message — complainant is the lead
    // (NOT the member who posted the offending content, to avoid self-complaint guard)
    const complaint = await fileComplaint(leadId, {
      projectId: project.id,
      threadId: thread.id,
      targetMessageId: offendingMessage.id,
      targetUserId: memberId, // the member who posted the offending content
      reason: "The message above contains offensive content that should be removed from public view.",
      evidenceText: "This is the offensive content that was quoted as evidence.",
    });

    // Moderator decides CONTENT_REMOVED
    await decideComplaint(complaint.id, modId, {
      action: "CONTENT_REMOVED",
      reason: "Content removed for violation; original preserved for audit per G06 policy.",
    });

    // Verify the complaint status is RESOLVED_REMOVED
    const fetched = await db.moderationComplaint.findUnique({ where: { id: complaint.id } });
    expect(fetched?.status).toBe("RESOLVED_REMOVED");
    expect(fetched?.evidenceText).toBe("This is the offensive content that was quoted as evidence.");

    // CRITICAL: the target message's removedAt is set (actual visibility enforcement)
    const message = await db.threadMessage.findUnique({ where: { id: offendingMessage.id } });
    expect(message?.removedAt).toBeTruthy();
    expect(message?.removedById).toBe(modId);
    // The original body is PRESERVED (not deleted)
    expect(message?.body).toBe("This is the offensive content that should be removed from view.");

    // CRITICAL: regular member sees "[removed]" placeholder, not the original content
    const memberView = await getThread(thread.id, memberId);
    const removedMessageInView = memberView.messages.find((m) => m.id === offendingMessage.id);
    expect(removedMessageInView?.removedAt).toBeTruthy();
    expect(removedMessageInView?.body).toBe("[removed — content hidden by moderation decision]");
    expect(removedMessageInView?.body).not.toContain("offensive content");

    // CRITICAL: admin/moderator CAN see the original content (for audit)
    const modView = await getThread(thread.id, modId);
    const modMessageView = modView.messages.find((m) => m.id === offendingMessage.id);
    expect(modMessageView?.removedAt).toBeTruthy();
    expect(modMessageView?.body).toBe("This is the offensive content that should be removed from view.");
  });
});

describe("G06-B — Cross-user visibility (test EXISTING complaints)", () => {
  it("unauthorized user cannot see an EXISTING complaint (NotFound, not Forbidden)", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const otherId = await createTestUser(run, "member");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Complaint that should be invisible to non-admin non-participants.",
    });
    // otherId (not admin, not mod, not complainant, not target) cannot see
    await expect(getComplaint(complaint.id, otherId)).rejects.toThrow(NotFoundError);
  });

  it("target user can see complaint against them (transparency)", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Complaint that the target should be able to see for transparency.",
    });
    const fetched = await getComplaint(complaint.id, targetId);
    expect(fetched.id).toBe(complaint.id);
  });

  it("regular member cannot list all complaints", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const otherId = await createTestUser(run, "member");
    await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Complaint that should not be listable by regular members.",
    });
    await expect(listComplaints(otherId)).rejects.toThrow(ForbiddenError);
  });
});

describe("G06-B — Optimistic lock on transitions", () => {
  it("prevents deciding an already-resolved complaint", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const modId = await createTestUser(run, "moderator");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Complaint that will be decided twice — second attempt should fail.",
    });
    await decideComplaint(complaint.id, modId, {
      action: "DISMISS",
      reason: "Complaint dismissed — insufficient evidence to proceed.",
    });
    // Second decision attempt on the same (now RESOLVED_DISMISSED) complaint
    await expect(
      decideComplaint(complaint.id, modId, {
        action: "WARNING",
        reason: "Second decision attempt — should be blocked.",
      }),
    ).rejects.toThrow(ConflictError);
  });
});
