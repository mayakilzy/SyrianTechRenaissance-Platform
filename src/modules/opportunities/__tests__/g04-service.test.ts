/**
 * STR G04 — Opportunity & Application Service Tests
 *
 * Tests the critical G04 invariants using isolated test data:
 *   1. Opportunity lifecycle: create → submit → review → publish
 *   2. Conflict of interest: creator cannot review own opportunity
 *   3. Application: create, duplicate prevention, decide, withdraw
 *   4. Atomic state transitions: concurrent review + concurrent decision/withdraw
 *   5. Privacy: qualificationNotes not exposed to applicant
 *   6. Authorization: only creator/reviewer can see applications
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { startTestRun, cleanupTestRun, createTestUser, type TestRun } from "@/modules/proposals/__tests__/test-isolation";
import {
  createOpportunity,
  submitOpportunity,
  reviewOpportunity,
  closeOpportunity,
  cancelOpportunity,
  applyForOpportunity,
  decideApplication,
  withdrawApplication,
  getApplicationsForOpportunity,
  getMyApplications,
} from "@/modules/opportunities/service";
import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from "@/lib/errors";

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

const validOpp = {
  title: "Test Opportunity for G04",
  description: "This is a test opportunity for G04 testing purposes with sufficient length.",
  type: "PROJECT" as const,
  requirements: "React, Node.js, PostgreSQL",
  isRemote: true,
};

describe("G04 — Opportunity lifecycle", () => {
  it("creates an opportunity in DRAFT", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const opp = await createOpportunity(creatorId, validOpp);
    expect(opp.status).toBe("DRAFT");
    expect(opp.title).toBe("Test Opportunity for G04");
  });

  it("transitions DRAFT → SUBMITTED → PUBLISHED", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const stewardId = await createTestUser(run, "steward");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);

    // Reviewer approves (not the creator — conflict of interest).
    await reviewOpportunity({
      opportunityId: opp.id,
      reviewerId,
      action: "APPROVE",
      reason: "This opportunity meets all criteria and is approved for publication.",
    });

    const updated = await db.opportunity.findUnique({ where: { id: opp.id } });
    expect(updated?.status).toBe("PUBLISHED");
    expect(updated?.publishedAt).toBeTruthy();
  });

  it("prevents creator from reviewing own opportunity (conflict of interest)", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "reviewer"); // creator has reviewer role
    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);

    await expect(
      reviewOpportunity({
        opportunityId: opp.id,
        reviewerId: creatorId, // same as creator!
        action: "APPROVE",
        reason: "Should be blocked by conflict of interest guard.",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("prevents regular member from reviewing", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const memberId = await createTestUser(run, "member");
    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);

    await expect(
      reviewOpportunity({
        opportunityId: opp.id,
        reviewerId: memberId,
        action: "APPROVE",
        reason: "Should be blocked — member has no reviewer role.",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows creator to close a PUBLISHED opportunity", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for closing test purposes.",
    });
    await closeOpportunity(opp.id, creatorId);
    const updated = await db.opportunity.findUnique({ where: { id: opp.id } });
    expect(updated?.status).toBe("CLOSED");
  });
});

describe("G04 — Applications", () => {
  it("allows applying to a PUBLISHED opportunity", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for application testing purposes.",
    });

    const app = await applyForOpportunity(opp.id, applicantId, "I am a great fit.");
    expect(app.status).toBe("SUBMITTED");
  });

  it("prevents duplicate applications (unique constraint)", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for duplicate application testing.",
    });

    await applyForOpportunity(opp.id, applicantId, "First application.");
    await expect(
      applyForOpportunity(opp.id, applicantId, "Second application."),
    ).rejects.toThrow(ConflictError);
  });

  it("prevents creator from applying to own opportunity", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for self-apply prevention test.",
    });

    await expect(
      applyForOpportunity(opp.id, creatorId, "I want to apply to my own."),
    ).rejects.toThrow(ForbiddenError);
  });

  it("prevents applying to non-PUBLISHED opportunity", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const applicantId = await createTestUser(run, "member");
    const opp = await createOpportunity(creatorId, validOpp);
    // Still DRAFT — not submitted or published.
    await expect(
      applyForOpportunity(opp.id, applicantId, "Apply to draft."),
    ).rejects.toThrow(ConflictError);
  });

  it("accepts an application and records decision", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for decision testing purposes.",
    });

    const app = await applyForOpportunity(opp.id, applicantId, "Hire me please.");
    await decideApplication(app.id, creatorId, "ACCEPTED", "Great fit for the role.", "Strong portfolio.");

    const updated = await db.opportunityApplication.findUnique({ where: { id: app.id } });
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.decisionReason).toBe("Great fit for the role.");
    expect(updated?.qualificationNotes).toBe("Strong portfolio.");
    expect(updated?.decidedAt).toBeTruthy();
  });

  it("allows applicant to withdraw before decision", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for withdrawal testing purposes.",
    });

    const app = await applyForOpportunity(opp.id, applicantId, "Withdraw me.");
    await withdrawApplication(app.id, applicantId);

    const updated = await db.opportunityApplication.findUnique({ where: { id: app.id } });
    expect(updated?.status).toBe("WITHDRAWN");
    expect(updated?.withdrawnAt).toBeTruthy();
  });

  it("prevents withdrawal after decision (atomic lock)", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for post-decision withdrawal test.",
    });

    const app = await applyForOpportunity(opp.id, applicantId, "Test.");
    await decideApplication(app.id, creatorId, "ACCEPTED", "Accepted for testing.");

    await expect(
      withdrawApplication(app.id, applicantId),
    ).rejects.toThrow(ConflictError);
  });
});

describe("G04 — Privacy & Authorization", () => {
  it("prevents non-creator non-reviewer from seeing applications", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");
    const otherMemberId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for privacy testing purposes.",
    });

    await applyForOpportunity(opp.id, applicantId, "Private application.");

    // Other member (not creator, not reviewer) cannot see applications.
    await expect(
      getApplicationsForOpportunity(opp.id, otherMemberId),
    ).rejects.toThrow(ForbiddenError);
  });

  it("qualificationNotes are NOT returned in getMyApplications (applicant's view)", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for qualification notes privacy test.",
    });

    const app = await applyForOpportunity(opp.id, applicantId, "Hire me.");
    await decideApplication(app.id, creatorId, "ACCEPTED", "Good fit.", "Private internal notes.");

    // Applicant views their own applications — qualificationNotes should NOT be included.
    const myApps = await getMyApplications(applicantId);
    expect(myApps.length).toBe(1);
    // getMyApplications returns applications without qualificationNotes
    // (Prisma select doesn't include it by default in the include).
    // The field exists in DB but is not exposed via this function.
    const myApp = myApps[0];
    if (!myApp) throw new Error("application not found");
    expect(myApp.status).toBe("ACCEPTED");
    expect(myApp.decisionReason).toBe("Good fit.");
    // qualificationNotes is not in the select — it's null/undefined.
    expect((myApp as Record<string, unknown>).qualificationNotes).toBeUndefined();
  });
});

describe("G04 — Concurrent operations", () => {
  it("concurrent reviews: exactly one succeeds (optimistic lock)", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewer1Id = await createTestUser(run, "reviewer", "Reviewer 1");
    const reviewer2Id = await createTestUser(run, "reviewer", "Reviewer 2");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);

    // Two reviewers try to approve simultaneously.
    const results = await Promise.allSettled([
      reviewOpportunity({
        opportunityId: opp.id, reviewerId: reviewer1Id, action: "APPROVE",
        reason: "First concurrent review approval for testing.",
      }),
      reviewOpportunity({
        opportunityId: opp.id, reviewerId: reviewer2Id, action: "REJECT",
        reason: "Second concurrent review rejection for testing.",
      }),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);

    // Exactly one status change happened.
    const updated = await db.opportunity.findUnique({ where: { id: opp.id } });
    expect(["PUBLISHED", "CANCELLED"]).toContain(updated?.status);

    // Exactly one review record.
    const reviews = await db.opportunityReview.count({ where: { opportunityId: opp.id } });
    // Note: both may create review records before the optimistic lock fails,
    // because the review create is inside the transaction but the updateMany
    // is what enforces the lock. The transaction rolls back on failure,
    // so only the successful transaction's review persists.
    expect(reviews).toBe(1);
  });

  it("concurrent decision + withdrawal: exactly one succeeds", async () => {
    run = startTestRun();
    const creatorId = await createTestUser(run, "member");
    const reviewerId = await createTestUser(run, "reviewer");
    const applicantId = await createTestUser(run, "member");

    const opp = await createOpportunity(creatorId, validOpp);
    await submitOpportunity(opp.id, creatorId);
    await reviewOpportunity({
      opportunityId: opp.id, reviewerId, action: "APPROVE",
      reason: "Approved for concurrency testing purposes.",
    });

    const app = await applyForOpportunity(opp.id, applicantId, "Concurrent test.");

    // Creator decides + applicant withdraws simultaneously.
    const results = await Promise.allSettled([
      decideApplication(app.id, creatorId, "ACCEPTED", "Accepted concurrently."),
      withdrawApplication(app.id, applicantId),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(1); // Exactly one wins.

    // The application is in exactly one final state.
    const updated = await db.opportunityApplication.findUnique({ where: { id: app.id } });
    expect(["ACCEPTED", "WITHDRAWN"]).toContain(updated?.status);
  });
});
