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
  it("admin can suspend a user (atomic with audit event)", async () => {
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
    expect(result.newStatus).toBe("ESCALATED"); // ESCALATED is the status for USER_SUSPENDED decisions
    // Verify user is actually suspended
    const target = await db.user.findUnique({ where: { id: targetId } });
    expect(target?.status).toBe("SUSPENDED");
    // Verify audit event recorded
    const audit = await db.auditEvent.findFirst({
      where: { action: "moderation.user_suspended", targetId: complaint.id },
    });
    expect(audit).toBeTruthy();
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
  it("CONTENT_REMOVED does not delete the complaint or evidence", async () => {
    run = startTestRun();
    const complainantId = await createTestUser(run, "member");
    const targetId = await createTestUser(run, "member");
    const modId = await createTestUser(run, "moderator");
    const complaint = await fileComplaint(complainantId, {
      targetUserId: targetId,
      reason: "Offensive content that should be removed but preserved for audit purposes.",
      evidenceText: "This is the offensive content that was quoted as evidence.",
    });
    await decideComplaint(complaint.id, modId, {
      action: "CONTENT_REMOVED",
      reason: "Content removed for violation; original preserved for audit per G06 policy.",
    });
    // Verify the complaint + evidence are still in the DB (NOT deleted)
    const fetched = await db.moderationComplaint.findUnique({ where: { id: complaint.id } });
    expect(fetched).toBeTruthy();
    expect(fetched?.evidenceText).toBe("This is the offensive content that was quoted as evidence.");
    expect(fetched?.status).toBe("RESOLVED_REMOVED");
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
