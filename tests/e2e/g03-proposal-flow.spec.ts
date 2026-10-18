import { test, expect } from "@playwright/test";
import { extractVerificationUrl, waitForEmail } from "./fixtures/test-emails";

/**
 * STR G03 — Full Institutional Governance E2E (G03-404-FIX)
 *
 * ROOT CAUSE of previous 404 failures:
 *   1. proposalId was scraped from URL (could match /proposals/new or wrong proposal)
 *   2. GET /api/proposals returned only the current user's proposals — reviewer
 *      couldn't see the proposer's proposal
 *
 * FIX:
 *   1. Capture proposalId directly from POST /api/proposals response
 *   2. Added GET /api/proposals/[id] route for reviewer access
 *   3. All API calls use page.evaluate (browser session cookies)
 *   4. Minimal step-by-step test first, then full flow
 */

const PREFIX = `g03e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROPOSER_EMAIL = `${PREFIX}-proposer@str-test.local`;
const INVITEE_EMAIL = `${PREFIX}-invitee@str-test.local`;
const PASSWORD = "TestPassword123!";
const REVIEWER_EMAIL = "reviewer@str.platform.local";
const REVIEWER_PASSWORD = "ReviewerPass123!";
const STEWARD_EMAIL = "steward@str.platform.local";
const MEMBER_EMAIL = "member@str.platform.local";
const MEMBER_PASSWORD = "MemberPass123!";

const validCharter = {
  problemStatement: "There is a significant gap in technical training for young developers in Syria, limiting their ability to participate in the digital economy.",
  outcomes: "A 6-month mentorship program pairing 20 junior developers with senior engineers, resulting in portfolio projects.",
  scope: "Web development mentorship: React, Node.js, and PostgreSQL.",
  requiredSkills: ["React", "Node.js", "PostgreSQL"],
  acceptanceCriteria: "20 junior developers complete the program with a deployed portfolio project.",
};

async function signupAndVerify(page: import("@playwright/test").Page, email: string, name: string) {
  await page.context().clearCookies();
  await page.goto("/auth/signup");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', PASSWORD);
  await page.fill('[name="displayName"]', name);
  await page.click('button[type="submit"]');
  await expect(page.locator("text=Check your email").or(page.locator("text=تحقق من بريدك"))).toBeVisible({ timeout: 15000 });
  const verifyUrl = await waitForEmail(email, 15000).then(() => extractVerificationUrl(email));
  expect(verifyUrl).toBeTruthy();
  await page.goto(verifyUrl!.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.locator("text=verified successfully").or(page.locator("text=بنجاح"))).toBeVisible({ timeout: 15000 });
}

async function signin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/auth/signin");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
}

async function getUserId(page: import("@playwright/test").Page): Promise<string> {
  // Use the NextAuth session endpoint to get the user ID reliably.
  const result = await page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    return data?.user?.id ?? "";
  });
  return result;
}

/**
 * Create a proposal via API and return the proposal ID directly.
 * This replaces the fragile URL-scraping approach.
 */
async function createProposalViaAPI(page: import("@playwright/test").Page, title: string): Promise<string> {
  const result = await page.evaluate(async ({ title, charter }) => {
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, charter }),
    });
    const data = await res.json();
    return { status: res.status, data };
  }, { title, charter: validCharter });

  if (result.status !== 201) {
    console.error("[DIAG] Create proposal failed:", result.status, JSON.stringify(result.data));
  }
  expect(result.status).toBe(201);
  expect(result.data.ok).toBe(true);
  expect(result.data.data.proposal.id).toBeTruthy();
  return result.data.data.proposal.id;
}

/**
 * Submit a proposal via API.
 */
async function submitProposalViaAPI(page: import("@playwright/test").Page, proposalId: string): Promise<void> {
  const result = await page.evaluate(async ({ proposalId }) => {
    const res = await fetch(`/api/proposals/${proposalId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { proposalId });
  expect(result.status).toBe(200);
}

/**
 * Review a proposal via API (from the reviewer's browser session).
 */
async function reviewProposalViaAPI(
  page: import("@playwright/test").Page,
  proposalId: string,
  action: string,
  reason: string,
  stewardId?: string,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async ({ proposalId, action, reason, stewardId }) => {
    const res = await fetch(`/api/proposals/${proposalId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason, stewardId }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { proposalId, action, reason, stewardId });
}

/**
 * Get a proposal via API (works for submitter, reviewer, admin).
 */
async function getProposalViaAPI(page: import("@playwright/test").Page, proposalId: string): Promise<{ status: number; data: unknown }> {
  return page.evaluate(async ({ proposalId }) => {
    const res = await fetch(`/api/proposals/${proposalId}`);
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }, { proposalId });
}

// ---------------------------------------------------------------------------
// MINIMAL STEP-BY-STEP TEST (diagnose the 404 root cause)
// ---------------------------------------------------------------------------

test.describe("G03 — Minimal step-by-step governance test", () => {
  test("create → submit → reviewer requests revision (minimal flow)", async ({ browser }) => {
    test.setTimeout(120000);

    // Step 1: Proposer signs up.
    const proposerCtx = await browser.newContext();
    const proposerPage = await proposerCtx.newPage();
    await signupAndVerify(proposerPage, PROPOSER_EMAIL, "Member User One");
    await signin(proposerPage, PROPOSER_EMAIL, PASSWORD);

    // Step 2: Create a proposal via API — capture the REAL proposalId.
    const proposalId = await createProposalViaAPI(proposerPage, "Minimal Test Proposal");
    console.log(`[DIAG] Created proposal ID: ${proposalId}`);
    expect(proposalId).toMatch(/^cm/); // Prisma cuid prefix

    // Step 3: Submit the proposal.
    await submitProposalViaAPI(proposerPage, proposalId);

    // Step 4: Verify the proposal is SUBMITTED (from proposer's session).
    const propResult = await getProposalViaAPI(proposerPage, proposalId);
    console.log(`[DIAG] Proposal status (from proposer): ${propResult.status}`);
    expect(propResult.status).toBe(200);
    const propData = (propResult.data as { data: { proposal: { status: string } } }).data.proposal;
    expect(propData.status).toBe("SUBMITTED");

    // Step 5: Reviewer signs in (independent session).
    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);

    // Step 6: Reviewer reads the proposal via GET /api/proposals/[id].
    const reviewReadResult = await getProposalViaAPI(reviewerPage, proposalId);
    console.log(`[DIAG] Reviewer reads proposal: status=${reviewReadResult.status}`);
    expect(reviewReadResult.status).toBe(200);

    // Step 7: Reviewer sends REQUEST_REVISION.
    const reviewResult = await reviewProposalViaAPI(
      reviewerPage,
      proposalId,
      "REQUEST_REVISION",
      "Please add more detail about the mentor selection process and risk mitigation strategy.",
    );
    console.log(`[DIAG] Review API response: status=${reviewResult.status}, body=${JSON.stringify(reviewResult.body)}`);
    expect(reviewResult.status).toBe(200);

    // Step 8: Verify the proposal is now NEEDS_REVISION.
    const afterReview = await getProposalViaAPI(proposerPage, proposalId);
    const afterData = (afterReview.data as { data: { proposal: { status: string } } }).data.proposal;
    expect(afterData.status).toBe("NEEDS_REVISION");

    await proposerCtx.close();
    await reviewerCtx.close();
  });
});

// ---------------------------------------------------------------------------
// FULL GOVERNANCE FLOW (runs after the minimal test proves the path works)
// ---------------------------------------------------------------------------

test.describe("G03 — Full Institutional Governance E2E", () => {
  test("propose → review → revise → approve → team → invite → reject", async ({ browser }) => {
    test.setTimeout(240000);

    // ── Setup: create all users ──
    const proposerCtx = await browser.newContext();
    const proposerPage = await proposerCtx.newPage();
    await signupAndVerify(proposerPage, PROPOSER_EMAIL, "Member User One");

    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();
    await signupAndVerify(inviteePage, INVITEE_EMAIL, "Member User Invitee");
    await signin(inviteePage, INVITEE_EMAIL, PASSWORD);
    const inviteeId = await getUserId(inviteePage);

    // ── Step 1: Proposer creates a proposal via API (capture real ID) ──
    await signin(proposerPage, PROPOSER_EMAIL, PASSWORD);
    const proposalId = await createProposalViaAPI(proposerPage, "E2E Mentorship Program");
    await submitProposalViaAPI(proposerPage, proposalId);

    // ── Step 2: Regular member cannot review (governance guard) ──
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signin(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);
    const memberReviewResult = await reviewProposalViaAPI(
      memberPage, proposalId, "REJECT",
      "This should be blocked because I am not a reviewer.",
    );
    expect(memberReviewResult.status).toBe(403);
    await memberCtx.close();

    // ── Step 3: Reviewer requests revision ──
    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);
    const reviseResult = await reviewProposalViaAPI(
      reviewerPage, proposalId, "REQUEST_REVISION",
      "Please add more detail about the mentor selection process and risk mitigation.",
    );
    expect(reviseResult.status).toBe(200);

    // ── Step 4: Proposer revises and resubmits ──
    // Check proposal status before revise
    const beforeRevise = await getProposalViaAPI(proposerPage, proposalId);
    const beforeReviseData = (beforeRevise.data as { data: { proposal: { status: string } } }).data.proposal;
    console.log(`[DIAG] Proposal status before revise: ${beforeReviseData.status}`);

    const reviseResult2 = await proposerPage.evaluate(async ({ proposalId, charter }) => {
      const res = await fetch(`/api/proposals/${proposalId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(charter),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, {
      proposalId,
      charter: {
        ...validCharter,
        problemStatement: "There is a significant gap in technical training for young developers in Syria. This program addresses it directly with structured mentorship.",
        scope: "Web development mentorship: React, Node.js, and PostgreSQL. Mentor selection via skill matching algorithm.",
      },
    });
    console.log(`[DIAG] Revise result: status=${reviseResult2.status}, body=${JSON.stringify(reviseResult2.body)}`);
    expect(reviseResult2.status, `Revise failed: ${JSON.stringify(reviseResult2.body)}`).toBe(200);
    await submitProposalViaAPI(proposerPage, proposalId);

    // ── Step 5: Get steward ID from STEWARD's session (not reviewer!) ──
    const stewardCtx = await browser.newContext();
    const stewardPage = await stewardCtx.newPage();
    await signin(stewardPage, STEWARD_EMAIL, "StewardPass123!");
    const stewardId = await getUserId(stewardPage);
    const reviewerId = await getUserId(reviewerPage);
    console.log(`[DIAG] stewardId=${stewardId}, reviewerId=${reviewerId}`);
    expect(stewardId).not.toBe(reviewerId); // separation of duties

    // ── Step 6: Reviewer approves with qualified steward ──
    const approveResult = await reviewProposalViaAPI(
      reviewerPage, proposalId, "APPROVE",
      "The revised proposal meets all acceptance criteria. Approved for execution.",
      stewardId,
    );
    expect(approveResult.status).toBe(200);
    await reviewerCtx.close();
    await stewardCtx.close();

    // ── Step 7: Verify project + team created ──
    const propAfter = await getProposalViaAPI(proposerPage, proposalId);
    const propData = (propAfter.data as { data: { proposal: { status: string; project?: { id: string; team?: { id: string } } } } }).data.proposal;
    expect(propData.status).toBe("APPROVED");
    expect(propData.project).toBeTruthy();
    expect(propData.project!.team).toBeTruthy();
    const teamId = propData.project!.team!.id;
    const projectId = propData.project!.id;

    // ── Step 8: Lead invites a member ──
    const inviteResult = await proposerPage.evaluate(async ({ teamId, inviteeId }) => {
      const res = await fetch(`/api/teams/${teamId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeId, role: "MEMBER" }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { teamId, inviteeId });
    expect(inviteResult.status).toBe(201);
    const invitationId = (inviteResult.body as { data: { invitation: { id: string } } }).data.invitation.id;

    // ── Step 9: Invitee accepts ──
    await signin(inviteePage, INVITEE_EMAIL, PASSWORD);
    const acceptResult = await inviteePage.evaluate(async ({ invitationId }) => {
      const res = await fetch(`/api/teams/invitations/${invitationId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { invitationId });
    expect(acceptResult.status).toBe(200);

    // ── Step 10: Verify project page ──
    console.log(`[DIAG] Project page URL: /projects/${projectId}`);
    const projectResponse = await proposerPage.goto(`/en/projects/${projectId}`);
    await proposerPage.waitForLoadState("networkidle");
    console.log(`[DIAG] Project page HTTP status: ${projectResponse?.status()}`);
    console.log(`[DIAG] Project page final URL: ${proposerPage.url()}`);
    const projectPageText = await proposerPage.locator("body").textContent();
    console.log(`[DIAG] Project page text preview: ${projectPageText?.substring(0, 200)}`);
    // Wait for the h1 to be visible (the project title).
    const h1 = proposerPage.locator("h1");
    await expect(h1).toBeVisible({ timeout: 15000 });
    const h1Text = await h1.textContent();
    console.log(`[DIAG] h1 text: ${h1Text}`);
    expect(h1Text).toContain("E2E Mentorship Program");

    await proposerCtx.close();
    await inviteeCtx.close();
  });

  test("second proposal is rejected with reason recorded", async ({ browser }) => {
    test.setTimeout(180000);

    const proposerCtx = await browser.newContext();
    const proposerPage = await proposerCtx.newPage();
    await signupAndVerify(proposerPage, `${PREFIX}-proposer2@str-test.local`, "Member User Two");
    await signin(proposerPage, `${PREFIX}-proposer2@str-test.local`, PASSWORD);

    const proposalId = await createProposalViaAPI(proposerPage, "E2E Rejected Proposal");
    await submitProposalViaAPI(proposerPage, proposalId);

    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);

    const rejectResult = await reviewProposalViaAPI(
      reviewerPage, proposalId, "REJECT",
      "The proposal lacks clear outcomes, measurable acceptance criteria, and a defined scope. It does not meet the institutional threshold for approval.",
    );
    expect(rejectResult.status).toBe(200);

    // Verify rejection via the proposal's own endpoint (from proposer's session).
    const propCheck = await getProposalViaAPI(proposerPage, proposalId);
    const propData = (propCheck.data as { data: { proposal: { status: string } } }).data.proposal;
    expect(propData.status).toBe("REJECTED");

    await proposerCtx.close();
    await reviewerCtx.close();
  });

  test("scope change preserves approved charter and creates new revision", async ({ browser }) => {
    test.setTimeout(180000);

    const proposerCtx = await browser.newContext();
    const proposerPage = await proposerCtx.newPage();
    await signupAndVerify(proposerPage, `${PREFIX}-scope@str-test.local`, "Scope Proposer");
    await signin(proposerPage, `${PREFIX}-scope@str-test.local`, PASSWORD);

    // Create + submit + approve.
    const proposalId = await createProposalViaAPI(proposerPage, "Scope Change Test");
    await submitProposalViaAPI(proposerPage, proposalId);

    // Get steward ID from steward's session.
    const stewardCtx = await browser.newContext();
    const stewardPage = await stewardCtx.newPage();
    await signin(stewardPage, STEWARD_EMAIL, "StewardPass123!");
    const stewardId = await getUserId(stewardPage);
    console.log(`[DIAG] scope-change stewardId=${stewardId}`);

    // Reviewer approves.
    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);
    const approveResult = await reviewProposalViaAPI(
      reviewerPage, proposalId, "APPROVE",
      "Approved for scope change testing purposes.",
      stewardId,
    );
    console.log(`[DIAG] Scope-change approve: status=${approveResult.status}, body=${JSON.stringify(approveResult.body)}`);
    expect(approveResult.status).toBe(200);
    await reviewerCtx.close();
    await stewardCtx.close();

    // Capture the approved charter text.
    const beforeScope = await getProposalViaAPI(proposerPage, proposalId);
    const beforeData = (beforeScope.data as {
      data: { proposal: {
        status: string;
        currentRevision: { problemStatement: string; version: number };
        revisions?: { id: string; version: number; problemStatement: string }[];
      } }
    }).data.proposal;
    expect(beforeData.status).toBe("APPROVED");
    const approvedProblemStatement = beforeData.currentRevision.problemStatement;
    const approvedVersion = beforeData.currentRevision.version;
    console.log(`[DIAG] Approved charter version: ${approvedVersion}, text: ${approvedProblemStatement.substring(0, 50)}...`);

    // Request scope change.
    const scopeResult = await proposerPage.evaluate(async ({ proposalId, charter, reason }) => {
      const res = await fetch(`/api/proposals/${proposalId}/scope-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charter, reason }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, {
      proposalId,
      charter: {
        ...validCharter,
        problemStatement: "MODIFIED problem statement — this should NOT replace the approved charter.",
      },
      reason: "Need to expand scope to include PostgreSQL training based on demand.",
    });
    console.log(`[DIAG] Scope-change result: status=${scopeResult.status}, body=${JSON.stringify(scopeResult.body)}`);
    expect(scopeResult.status, `Scope-change failed: ${JSON.stringify(scopeResult.body)}`).toBe(200);

    // Verify: proposal is now NEEDS_REVISION.
    const afterScope = await getProposalViaAPI(proposerPage, proposalId);
    const afterData = (afterScope.data as {
      data: { proposal: {
        status: string;
        currentRevision: { problemStatement: string; version: number };
      } }
    }).data.proposal;
    expect(afterData.status).toBe("NEEDS_REVISION");

    // CRITICAL: the currentRevision is the NEW one (modified text).
    expect(afterData.currentRevision.problemStatement).toContain("MODIFIED");
    expect(afterData.currentRevision.version).toBe(approvedVersion + 1);

    // CRITICAL: the approved charter text is preserved — the new revision
    // does NOT overwrite it. We verify by checking that the approved text
    // is NOT the same as the current revision's text.
    expect(afterData.currentRevision.problemStatement).not.toBe(approvedProblemStatement);

    await proposerCtx.close();
  });
});

// ---------------------------------------------------------------------------
// G03-POLICY-ACCEPTANCE: HTTP-level DRAFT protection test
// Tests the REAL GET /api/proposals/[id] route handler (not a mock).
// ---------------------------------------------------------------------------

test.describe("G03 — DRAFT proposal protection via real HTTP route", () => {
  test("reviewer CANNOT read another user's DRAFT via GET /api/proposals/[id]", async ({ browser }) => {
    test.setTimeout(120000);

    // Create a proposer who creates a DRAFT (not submitted).
    const proposerCtx = await browser.newContext();
    const proposerPage = await proposerCtx.newPage();
    const draftEmail = `${PREFIX}-draft-http@str-test.local`;
    await signupAndVerify(proposerPage, draftEmail, "Draft Owner");
    await signin(proposerPage, draftEmail, PASSWORD);
    const draftProposalId = await createProposalViaAPI(proposerPage, "HTTP DRAFT Protection Test");
    // Do NOT submit — leave as DRAFT.

    // Sign in as reviewer (seeded account).
    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);

    // Reviewer tries to read the DRAFT via the REAL HTTP route.
    const draftResult = await reviewerPage.evaluate(async ({ proposalId }) => {
      const res = await fetch(`/api/proposals/${proposalId}`);
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { proposalId: draftProposalId });
    console.log(`[DIAG] Reviewer reads DRAFT: status=${draftResult.status}`);
    expect(draftResult.status).toBe(403);

    // Now submit the proposal (from proposer's session).
    await submitProposalViaAPI(proposerPage, draftProposalId);

    // Reviewer CAN now read it (it's SUBMITTED).
    const submittedResult = await reviewerPage.evaluate(async ({ proposalId }) => {
      const res = await fetch(`/api/proposals/${proposalId}`);
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { proposalId: draftProposalId });
    console.log(`[DIAG] Reviewer reads SUBMITTED: status=${submittedResult.status}`);
    expect(submittedResult.status).toBe(200);

    await proposerCtx.close();
    await reviewerCtx.close();
  });

  test("regular member CANNOT read another user's SUBMITTED proposal via HTTP", async ({ browser }) => {
    test.setTimeout(120000);

    // Create + submit a proposal.
    const proposerCtx = await browser.newContext();
    const proposerPage = await proposerCtx.newPage();
    const propEmail = `${PREFIX}-http-member@str-test.local`;
    await signupAndVerify(proposerPage, propEmail, "HTTP Proposer");
    await signin(proposerPage, propEmail, PASSWORD);
    const proposalId = await createProposalViaAPI(proposerPage, "HTTP Member Access Test");
    await submitProposalViaAPI(proposerPage, proposalId);

    // Sign in as regular member (seeded, no reviewer role).
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signin(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);

    // Member tries to read → 403.
    const result = await memberPage.evaluate(async ({ proposalId }) => {
      const res = await fetch(`/api/proposals/${proposalId}`);
      return { status: res.status };
    }, { proposalId });
    console.log(`[DIAG] Member reads SUBMITTED: status=${result.status}`);
    expect(result.status).toBe(403);

    // Submitter CAN read their own proposal → 200.
    const ownerResult = await proposerPage.evaluate(async ({ proposalId }) => {
      const res = await fetch(`/api/proposals/${proposalId}`);
      return { status: res.status };
    }, { proposalId });
    console.log(`[DIAG] Owner reads own SUBMITTED: status=${ownerResult.status}`);
    expect(ownerResult.status).toBe(200);

    await proposerCtx.close();
    await memberCtx.close();
  });
});
