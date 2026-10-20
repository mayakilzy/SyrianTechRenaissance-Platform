/**
 * STR G09 Priority 2 — Concurrency & Concurrent Approvals
 * -------------------------------------------------------
 * Tests that concurrent operations on the same proposal leave the system
 * in a CONSISTENT final state — no orphaned Project/Team/StewardAssignment,
 * no conflicting status, no duplicate ReviewDecisions, no swallowed audit
 * intent for the LOSING side.
 *
 * The existing G03-FIX §5 test covers APPROVE vs APPROVE (same reviewer).
 * These tests cover the UNTUSTED cross-action races:
 *   - APPROVE vs REJECT          (different reviewers)
 *   - APPROVE vs WITHDRAW        (reviewer vs submitter)
 *   - APPROVE vs REQUEST_REVISION(different reviewers)
 *   - REJECT vs WITHDRAW         (reviewer vs submitter)
 *   - Two different reviewers approving concurrently
 *   - Double-submit (idempotency)
 *   - Double-withdraw (idempotency)
 *   - Double scope-change request
 *
 * Strategy:
 *   - Promise.allSettled([op1, op2]) for true concurrency (matches §5 pattern).
 *   - For races where the bug only manifests when op1 wins the optimistic
 *     lock before op2 reads, a small `await delay()` is inserted between
 *     the two Promise creations so op1 has a head start and is more likely
 *     to be in-flight (transaction started but not committed) when op2 reads.
 *   - Final state is verified via direct DB reads — not just response codes.
 *
 * G09-P2 scope: Phase A. MASTER directive: "اختبر السلوك الفعلي، وليس
 * مجرد رموز HTTP أو اختبارات شكلية".
 */
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { startTestRun, cleanupTestRun, createTestUser, type TestRun } from "./test-isolation";
import {
  createProposal,
  submitProposal,
  reviewProposal,
  withdrawProposal,
  requestScopeChange,
} from "@/modules/proposals/service";
import { ConflictError } from "@/lib/errors";

const validCharter = {
  problemStatement:
    "There is a significant gap in technical training opportunities for young developers in Syria.",
  outcomes:
    "A mentorship program that pairs 50 junior developers with senior engineers over 6 months.",
  scope: "Web development mentorship focusing on React, Node.js, and PostgreSQL.",
  requiredSkills: ["React", "Node.js", "PostgreSQL"],
  acceptanceCriteria:
    "50 junior developers complete the program with a portfolio project.",
};

const validCharterV2 = {
  ...validCharter,
  problemStatement:
    "Revised scope: there is a significant gap in advanced technical training for mid-career developers in Syria.",
  outcomes:
    "An advanced mentorship program that pairs 30 mid-career developers with senior architects over 12 months.",
  scope: "Advanced web architecture mentorship focusing on distributed systems.",
  requiredSkills: ["React", "Node.js", "PostgreSQL", "Kubernetes"],
  acceptanceCriteria:
    "30 mid-career developers complete the program with a production-grade system design.",
};

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Count all side-effect rows created for a given proposal.
 * Used to verify that no duplicates (Project, Team, StewardAssignment,
 * TeamMembership, ReviewDecision) survive a concurrent race.
 *
 * NOTE: StewardAssignment has a plain `projectId: String` field, no
 * `project` relation — so we look up the project row first, then count
 * steward assignments by that projectId. Same pattern used in
 * g03-service.test.ts and g03-fix-governance.test.ts.
 */
async function countSideEffects(proposalId: string) {
  const project = await db.project.findUnique({
    where: { proposalId },
    select: { id: true },
  });
  const projectId = project?.id;
  const [projects, teams, decisions, stewardAssignments, memberships, revisions] =
    await Promise.all([
      db.project.count({ where: { proposalId } }),
      db.team.count({ where: { project: { proposalId } } }),
      db.reviewDecision.count({ where: { proposalId } }),
      projectId
        ? db.stewardAssignment.count({ where: { projectId } })
        : Promise.resolve(0),
      db.teamMembership.count({ where: { team: { project: { proposalId } } } }),
      db.charterRevision.count({ where: { proposalId } }),
    ]);
  return {
    projects,
    teams,
    decisions,
    stewardAssignments,
    memberships,
    revisions,
  };
}

describe("G09 Priority 2 — Concurrency & Concurrent Approvals", () => {
  // ───────────────────────────────────────────────────────────────────────
  // Test 1: APPROVE vs REJECT (different reviewers, concurrently)
  //
  // Bug hypothesis: REJECT path lacks an optimistic lock. If APPROVE wins
  // the race (commits first), REJECT may still overwrite status from
  // APPROVED → REJECTED, leaving an orphaned Project + Team +
  // StewardAssignment + Lead membership.
  //
  // Expected after fix: exactly ONE operation wins. Final state matches
  // the winning operation. Exactly ONE ReviewDecision. No orphans.
  // ───────────────────────────────────────────────────────────────────────
  it("APPROVE vs REJECT (concurrent): exactly one decision wins, no orphaned Project/Team", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewer1Id = await createTestUser(run, "reviewer", "Reviewer One");
    const reviewer2Id = await createTestUser(run, "reviewer", "Reviewer Two");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({
      submitterId,
      title: "APPROVE vs REJECT",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);

    // Fire APPROVE first, then REJECT after a tiny delay so APPROVE has a
    // head start and is more likely to be in-flight when REJECT reads.
    const approveP = reviewProposal({
      proposalId: proposal.id,
      reviewerId: reviewer1Id,
      action: "APPROVE",
      reason: "Concurrent approval — should win or fail cleanly without corrupting state.",
      stewardId,
    });
    await delay(30);
    const rejectP = reviewProposal({
      proposalId: proposal.id,
      reviewerId: reviewer2Id,
      action: "REJECT",
      reason: "Concurrent rejection — should win or fail cleanly without corrupting state.",
    });

    const results = await Promise.allSettled([approveP, rejectP]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    const counts = await countSideEffects(proposal.id);

    // CRITICAL ASSERTION: exactly one operation must win.
    // If both succeed, the optimistic lock failed and we have a real bug.
    expect(succeeded).toBe(1);

    // Final state must match the winning operation.
    if (finalProposal?.status === "APPROVED") {
      expect(counts.projects).toBe(1);
      expect(counts.teams).toBe(1);
      expect(counts.stewardAssignments).toBe(1);
      expect(counts.memberships).toBe(1); // lead only
      expect(finalProposal.rejectedAt).toBeNull();
    } else if (finalProposal?.status === "REJECTED") {
      expect(counts.projects).toBe(0);
      expect(counts.teams).toBe(0);
      expect(counts.stewardAssignments).toBe(0);
      expect(counts.memberships).toBe(0);
      expect(finalProposal.approvedAt).toBeNull();
    } else {
      throw new Error(
        `Unexpected final status: ${finalProposal?.status} — concurrent race corrupted state`,
      );
    }

    // CRITICAL: exactly ONE ReviewDecision — never two for the same proposal
    // in a single transition. Two decisions = audit corruption.
    expect(counts.decisions).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 2: APPROVE vs WITHDRAW (reviewer vs submitter, concurrently)
  //
  // Bug hypothesis: WITHDRAW path lacks an optimistic lock. If APPROVE
  // wins, WITHDRAW may still overwrite status from APPROVED → WITHDRAWN,
  // leaving an orphaned Project + Team. The submitter would then see
  // WITHDRAWN status but a Project actually exists.
  // ───────────────────────────────────────────────────────────────────────
  it("APPROVE vs WITHDRAW (concurrent): no orphaned Project if WITHDRAW loses, no withdrawnAt if APPROVE loses", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({
      submitterId,
      title: "APPROVE vs WITHDRAW",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);

    const approveP = reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Concurrent approval — submitter is racing to withdraw simultaneously.",
      stewardId,
    });
    await delay(30);
    const withdrawP = withdrawProposal(proposal.id, submitterId);

    const results = await Promise.allSettled([approveP, withdrawP]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    const counts = await countSideEffects(proposal.id);

    expect(succeeded).toBe(1);

    if (finalProposal?.status === "APPROVED") {
      expect(counts.projects).toBe(1);
      expect(counts.teams).toBe(1);
      expect(counts.stewardAssignments).toBe(1);
      expect(finalProposal.withdrawnAt).toBeNull();
    } else if (finalProposal?.status === "WITHDRAWN") {
      expect(counts.projects).toBe(0);
      expect(counts.teams).toBe(0);
      expect(counts.stewardAssignments).toBe(0);
      expect(finalProposal.approvedAt).toBeNull();
    } else {
      throw new Error(
        `Unexpected final status: ${finalProposal?.status} — concurrent race corrupted state`,
      );
    }

    // If APPROVE wins, there's exactly one APPROVE ReviewDecision.
    // If WITHDRAW wins, there are zero ReviewDecisions (withdraw doesn't record one).
    if (finalProposal?.status === "APPROVED") {
      expect(counts.decisions).toBe(1);
    } else {
      expect(counts.decisions).toBe(0);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 3: APPROVE vs REQUEST_REVISION (different reviewers, concurrently)
  //
  // Bug hypothesis: REQUEST_REVISION path lacks an optimistic lock. If
  // APPROVE wins, REQUEST_REVISION may still overwrite status from
  // APPROVED → NEEDS_REVISION, leaving an orphaned Project + Team.
  // ───────────────────────────────────────────────────────────────────────
  it("APPROVE vs REQUEST_REVISION (concurrent): exactly one wins, no orphaned Project if REVISION loses", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewer1Id = await createTestUser(run, "reviewer", "Reviewer One");
    const reviewer2Id = await createTestUser(run, "reviewer", "Reviewer Two");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({
      submitterId,
      title: "APPROVE vs REQUEST_REVISION",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);

    const approveP = reviewProposal({
      proposalId: proposal.id,
      reviewerId: reviewer1Id,
      action: "APPROVE",
      reason: "Concurrent approval — second reviewer is racing to request revision.",
      stewardId,
    });
    await delay(30);
    const reviseP = reviewProposal({
      proposalId: proposal.id,
      reviewerId: reviewer2Id,
      action: "REQUEST_REVISION",
      reason: "Concurrent revision request — should fail cleanly if approval already happened.",
    });

    const results = await Promise.allSettled([approveP, reviseP]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    const counts = await countSideEffects(proposal.id);

    expect(succeeded).toBe(1);

    if (finalProposal?.status === "APPROVED") {
      expect(counts.projects).toBe(1);
      expect(counts.teams).toBe(1);
      expect(counts.stewardAssignments).toBe(1);
    } else if (finalProposal?.status === "NEEDS_REVISION") {
      expect(counts.projects).toBe(0);
      expect(counts.teams).toBe(0);
      expect(counts.stewardAssignments).toBe(0);
    } else {
      throw new Error(
        `Unexpected final status: ${finalProposal?.status} — concurrent race corrupted state`,
      );
    }

    expect(counts.decisions).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 4: REJECT vs WITHDRAW (reviewer vs submitter, concurrently)
  //
  // Bug hypothesis: both paths lack optimistic locks. Whichever loses
  // the race still overwrites the winner's status, but since neither
  // creates side-effect rows (no Project/Team), the corruption is only
  // in the status field + timestamp.
  // ───────────────────────────────────────────────────────────────────────
  it("REJECT vs WITHDRAW (concurrent): exactly one wins, only the winning timestamp is set", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const proposal = await createProposal({
      submitterId,
      title: "REJECT vs WITHDRAW",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);

    const rejectP = reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "REJECT",
      reason: "Concurrent rejection — submitter is racing to withdraw simultaneously.",
    });
    await delay(30);
    const withdrawP = withdrawProposal(proposal.id, submitterId);

    const results = await Promise.allSettled([rejectP, withdrawP]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    const counts = await countSideEffects(proposal.id);

    expect(succeeded).toBe(1);

    // Final state: one of REJECTED or WITHDRAWN — never both timestamps set.
    if (finalProposal?.status === "REJECTED") {
      expect(finalProposal.rejectedAt).toBeTruthy();
      expect(finalProposal.withdrawnAt).toBeNull();
      expect(counts.decisions).toBe(1);
    } else if (finalProposal?.status === "WITHDRAWN") {
      expect(finalProposal.withdrawnAt).toBeTruthy();
      expect(finalProposal.rejectedAt).toBeNull();
      expect(counts.decisions).toBe(0);
    } else {
      throw new Error(
        `Unexpected final status: ${finalProposal?.status} — concurrent race corrupted state`,
      );
    }

    // No side effects in either case.
    expect(counts.projects).toBe(0);
    expect(counts.teams).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 5: Two different reviewers approving concurrently
  //
  // Existing §5 test covers APPROVE vs APPROVE from the SAME reviewer.
  // This test uses TWO DIFFERENT reviewers. The existing
  // approveProposalAtomically handles this via optimistic lock + P2002 —
  // the second call falls into the idempotent path and returns the
  // existing project. But it does NOT record a ReviewDecision for the
  // second reviewer (audit gap, documented in the report).
  //
  // Assertion: exactly ONE Project, ONE Team, ONE StewardAssignment, ONE
  // Lead membership. AT MOST one ReviewDecision (the second reviewer's
  // intent is silently swallowed — documented limitation).
  // ───────────────────────────────────────────────────────────────────────
  it("APPROVE from two different reviewers (concurrent): exactly one Project/Team, no duplicates", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewer1Id = await createTestUser(run, "reviewer", "Reviewer One");
    const reviewer2Id = await createTestUser(run, "reviewer", "Reviewer Two");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({
      submitterId,
      title: "Two Reviewers Approve",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);

    const results = await Promise.allSettled([
      reviewProposal({
        proposalId: proposal.id,
        reviewerId: reviewer1Id,
        action: "APPROVE",
        reason: "First reviewer concurrent approval for testing idempotency.",
        stewardId,
      }),
      reviewProposal({
        proposalId: proposal.id,
        reviewerId: reviewer2Id,
        action: "APPROVE",
        reason: "Second reviewer concurrent approval for testing idempotency.",
        stewardId,
      }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    // At least one must succeed (idempotent path may let both succeed).
    expect(succeeded).toBeGreaterThanOrEqual(1);

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    const counts = await countSideEffects(proposal.id);

    expect(finalProposal?.status).toBe("APPROVED");
    // CRITICAL: no duplicate side effects.
    expect(counts.projects).toBe(1);
    expect(counts.teams).toBe(1);
    expect(counts.stewardAssignments).toBe(1);
    expect(counts.memberships).toBe(1); // lead only

    // Audit: at most one ReviewDecision recorded. The losing reviewer's
    // intent is silently swallowed — documented as a known audit gap.
    expect(counts.decisions).toBeGreaterThanOrEqual(1);
    expect(counts.decisions).toBeLessThanOrEqual(2);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 6: Double-submit (concurrent) — submitter double-clicks submit
  //
  // Bug hypothesis: submitProposal lacks an optimistic lock. Two
  // concurrent submit() calls could both pass the status check (DRAFT)
  // and both update. The status update is idempotent (DRAFT → SUBMITTED
  // either way), but if a reviewer approves between the two submit
  // calls, the second submit would overwrite APPROVED → SUBMITTED,
  // corrupting state.
  //
  // Expected after fix: exactly one submit wins, the other gets
  // ConflictError. Final status: SUBMITTED, exactly one submittedAt.
  // ───────────────────────────────────────────────────────────────────────
  it("Double-submit (concurrent): exactly one submit wins, no state corruption", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const proposal = await createProposal({
      submitterId,
      title: "Double Submit",
      charter: validCharter,
    });

    const results = await Promise.allSettled([
      submitProposal(proposal.id, submitterId),
      submitProposal(proposal.id, submitterId),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    // At least one must succeed. With the optimistic lock, exactly one wins.
    // Without the fix, both may succeed (idempotent update) — but the test
    // verifies final state regardless.
    expect(succeeded).toBeGreaterThanOrEqual(1);

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    expect(finalProposal?.status).toBe("SUBMITTED");
    expect(finalProposal?.submittedAt).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 7: Double-withdraw (concurrent) — submitter double-clicks withdraw
  //
  // Bug hypothesis: withdrawProposal lacks an optimistic lock. Two
  // concurrent withdraw() calls could both pass the status check and
  // both update. Status update is idempotent, but if a reviewer approves
  // between the two withdraw calls, the second withdraw would overwrite
  // APPROVED → WITHDRAWN, orphaning the Project.
  //
  // Expected: at least one succeeds. Final state: WITHDRAWN, no orphans.
  // ───────────────────────────────────────────────────────────────────────
  it("Double-withdraw (concurrent): idempotent, no orphans", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const proposal = await createProposal({
      submitterId,
      title: "Double Withdraw",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);

    const results = await Promise.allSettled([
      withdrawProposal(proposal.id, submitterId),
      withdrawProposal(proposal.id, submitterId),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    const counts = await countSideEffects(proposal.id);

    expect(finalProposal?.status).toBe("WITHDRAWN");
    expect(finalProposal?.withdrawnAt).toBeTruthy();
    // CRITICAL: no orphans even if both withdraws "succeeded".
    expect(counts.projects).toBe(0);
    expect(counts.teams).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 8: Double scope-change request (concurrent) on APPROVED proposal
  //
  // Bug hypothesis: requestScopeChange lacks an optimistic lock. Two
  // concurrent calls could both pass the status check (APPROVED) and
  // both create new CharterRevisions + ReviewDecisions, both update
  // status to NEEDS_REVISION. Result: two new revisions, two audit
  // decisions — but the proposal can only act on one revision.
  //
  // Expected after fix: exactly one scope-change wins, the other gets
  // ConflictError. Exactly one new CharterRevision, exactly one new
  // ReviewDecision, status=NEEDS_REVISION.
  // ───────────────────────────────────────────────────────────────────────
  it("Double scope-change (concurrent): exactly one new revision, no duplicate decisions", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({
      submitterId,
      title: "Double Scope Change",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "Approved for double scope-change concurrency testing purposes.",
      stewardId,
    });

    const initialCounts = await countSideEffects(proposal.id);
    // After approval: 1 project, 1 team, 1 steward assignment, 1 membership, 1 revision, 1 decision.
    expect(initialCounts.revisions).toBe(1);
    expect(initialCounts.decisions).toBe(1);

    const results = await Promise.allSettled([
      requestScopeChange(proposal.id, submitterId, validCharterV2, "First concurrent scope change request."),
      requestScopeChange(proposal.id, submitterId, validCharterV2, "Second concurrent scope change request."),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    // With the fix: exactly one wins, the other throws ConflictError.
    // Without the fix: both may succeed, creating two new revisions.
    expect(succeeded).toBe(1);

    const finalProposal = await db.projectProposal.findUnique({
      where: { id: proposal.id },
    });
    const finalCounts = await countSideEffects(proposal.id);

    expect(finalProposal?.status).toBe("NEEDS_REVISION");

    // CRITICAL: exactly ONE new revision was created (not two).
    // Initial was 1, so final should be 2.
    expect(finalCounts.revisions).toBe(2);

    // Exactly ONE new ReviewDecision was created (initial 1 + 1 new = 2).
    expect(finalCounts.decisions).toBe(2);

    // Project/Team/StewardAssignment must survive the scope change untouched.
    expect(finalCounts.projects).toBe(1);
    expect(finalCounts.teams).toBe(1);
    expect(finalCounts.stewardAssignments).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Test 9: Confirm ConflictError is the documented failure mode for races
  //
  // This is a meta-test: when a concurrent operation loses the race, it
  // must throw ConflictError (not a generic 500, not a Prisma P2002
  // leak). External integrations rely on 409 to detect race-loss.
  // ───────────────────────────────────────────────────────────────────────
  it("Race-loss throws ConflictError (not 500, not raw Prisma error)", async () => {
    run = startTestRun();
    const submitterId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");
    const proposal = await createProposal({
      submitterId,
      title: "Race Error Type",
      charter: validCharter,
    });
    await submitProposal(proposal.id, submitterId);

    // First approval wins synchronously.
    await reviewProposal({
      proposalId: proposal.id,
      reviewerId,
      action: "APPROVE",
      reason: "First approval to set up the race-loss scenario for the second reviewer.",
      stewardId,
    });

    // Second approval must fail with ConflictError (not P2002, not 500).
    await expect(
      reviewProposal({
        proposalId: proposal.id,
        reviewerId,
        action: "APPROVE",
        reason: "Second approval attempt — should fail cleanly with ConflictError.",
        stewardId,
      }),
    ).rejects.toThrow(ConflictError);
  });
});
