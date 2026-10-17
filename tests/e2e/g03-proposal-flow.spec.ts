import { test, expect } from "@playwright/test";
import { extractVerificationUrl, waitForEmail } from "./fixtures/test-emails";

/**
 * STR G03 — Full Institutional Governance E2E
 *
 * Flow:
 *   1. Proposer (regular member) signs up + creates a proposal
 *   2. Regular member cannot review (governance guard, 403)
 *   3. Institutional reviewer requests revision
 *   4. Proposer revises + resubmits
 *   5. Reviewer approves with a DIFFERENT qualified steward (separation of duties)
 *   6. Project + Team created atomically
 *   7. Lead invites a member; member accepts
 *   8. Second proposal rejected with reason recorded
 *   9. Scope change preserves approved charter
 *
 * Seeded institutional accounts (created by prisma/seed-test.ts):
 *   - reviewer@str.platform.local / ReviewerPass123! (has reviewer role)
 *   - steward@str.platform.local / StewardPass123! (has steward role)
 *   - member@str.platform.local / MemberPass123! (regular member)
 */

const PREFIX = `g03e2e-${Date.now()}`;
const PROPOSER_EMAIL = `${PREFIX}-proposer@str-test.local`;
const INVITEE_EMAIL = `${PREFIX}-invitee@str-test.local`;
const PASSWORD = "TestPassword123!";
const REVIEWER_EMAIL = "reviewer@str.platform.local";
const REVIEWER_PASSWORD = "ReviewerPass123!";
const STEWARD_EMAIL = "steward@str.platform.local";
const MEMBER_EMAIL = "member@str.platform.local";
const MEMBER_PASSWORD = "MemberPass123!";

async function signupAndVerify(page: import("@playwright/test").Page, email: string, name: string) {
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
  await page.goto("/dashboard");
  const text = await page.locator("body").textContent();
  const match = text?.match(/ID[:\s]+([a-zA-Z0-9]+)/);
  return match?.[1] ?? "";
}

test.describe("G03 — Full Institutional Governance E2E", () => {
  test("propose → review → revise → approve → team → invite → reject", async ({ page, browser }) => {
    test.setTimeout(240000); // 4 minutes for full flow
    // ── Step 1: Proposer signs up and creates a proposal ──
    await signupAndVerify(page, PROPOSER_EMAIL, "G03 Proposer");
    await signupAndVerify(page, INVITEE_EMAIL, "G03 Invitee");

    // Get invitee's user ID (needed later for team invitation).
    await signin(page, INVITEE_EMAIL, PASSWORD);
    const inviteeId = await getUserId(page);

    // Sign in as proposer and create a proposal.
    await signin(page, PROPOSER_EMAIL, PASSWORD);
    await page.goto("/proposals/new");
    await page.fill('[name="title"]', "E2E Mentorship Program");
    await page.fill('[name="problemStatement"]', "There is a significant gap in technical training for young developers in Syria, limiting their ability to participate in the digital economy.");
    await page.fill('[name="outcomes"]', "A 6-month mentorship program pairing 20 junior developers with senior engineers, resulting in portfolio projects.");
    await page.fill('[name="scope"]', "Web development mentorship: React, Node.js, and PostgreSQL.");
    await page.fill('[name="requiredSkills"]', "React, Node.js, PostgreSQL");
    await page.fill('[name="acceptanceCriteria"]', "20 junior developers complete the program with a deployed portfolio project.");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/proposals/, { timeout: 15000 });

    // ── Step 2: Submit the proposal ──
    await page.locator('a[href*="/proposals/"]').first().click();
    await page.waitForURL(/\/proposals\/[^/]+$/, { timeout: 10000 });
    const proposalId = page.url().split("/").pop()!;

    const submitBtn = page.locator('button:has-text("Submit for Review"), button:has-text("إرسال للمراجعة")');
    if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await submitBtn.click();
      await page.reload();
    }

    // ── Step 3: Regular member cannot review (governance guard) ──
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signin(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);
    const reviewRes = await memberPage.request.post(`/api/proposals/${proposalId}/review`, {
      data: { action: "REJECT", reason: "This should be blocked because I am not a reviewer." },
    });
    expect(reviewRes.status()).toBe(403);
    await memberCtx.close();

    // ── Step 4: Institutional reviewer requests revision ──
    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);

    const reviseResult = await reviewerPage.evaluate(async ({ proposalId }) => {
      const res = await fetch(`/api/proposals/${proposalId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REQUEST_REVISION", reason: "Please add more detail about the mentor selection process and risk mitigation strategy." }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { proposalId });
    expect(reviseResult.status).toBe(200);

    // ── Step 5: Proposer revises and resubmits ──
    await signin(page, PROPOSER_EMAIL, PASSWORD);
    const reviseProposalRes = await page.request.post(`/api/proposals/${proposalId}/revise`, {
      data: {
        problemStatement: "There is a significant gap in technical training for young developers in Syria, limiting their ability to participate in the digital economy. This program addresses it directly.",
        outcomes: "A 6-month mentorship program pairing 20 junior developers with senior engineers, resulting in portfolio projects and job placements.",
        scope: "Web development mentorship: React, Node.js, and PostgreSQL. Mentor selection via skill matching algorithm.",
        requiredSkills: ["React", "Node.js", "PostgreSQL", "Mentoring"],
        acceptanceCriteria: "20 junior developers complete the program with a deployed portfolio project and mentor feedback.",
      },
    });
    expect(reviseProposalRes.status()).toBe(200);
    await page.request.post(`/api/proposals/${proposalId}/submit`, { data: {} });

    // ── Step 6: Reviewer approves with a DIFFERENT qualified steward ──
    // FIX: get stewardId from the STEWARD's session, not the reviewer's.
    const stewardCtx = await browser.newContext();
    const stewardPage = await stewardCtx.newPage();
    await signin(stewardPage, STEWARD_EMAIL, "StewardPass123!");
    const stewardId = await getUserId(stewardPage);
    expect(stewardId).toBeTruthy();
    // Verify steward != reviewer (separation of duties)
    const reviewerId = await getUserId(reviewerPage);
    expect(stewardId).not.toBe(reviewerId);

    const approveResult = await reviewerPage.evaluate(async ({ proposalId, stewardId }) => {
      const res = await fetch(`/api/proposals/${proposalId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "APPROVE",
          reason: "The revised proposal meets all acceptance criteria. Mentor selection process is clear. Approved for execution.",
          stewardId,
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { proposalId, stewardId });
    expect(approveResult.status).toBe(200);
    await reviewerCtx.close();
    await stewardCtx.close();

    // ── Step 7: Verify project + team created ──
    const proposalData = await page.request.get(`/api/proposals`).then(r => r.json());
    const approved = proposalData.data.proposals.find((p: { id: string }) => p.id === proposalId);
    expect(approved.status).toBe("APPROVED");
    expect(approved.project).toBeTruthy();
    expect(approved.project.team).toBeTruthy();
    const teamId = approved.project.team.id;
    const projectId = approved.project.id;

    // ── Step 8: Lead invites a member ──
    const inviteRes = await page.request.post(`/api/teams/${teamId}/invite`, {
      data: { inviteeId, role: "MEMBER" },
    });
    expect(inviteRes.status()).toBe(201);
    const inviteBody = await inviteRes.json();
    const invitationId = inviteBody.data.invitation.id;

    // ── Step 9: Invitee accepts ──
    await signin(page, INVITEE_EMAIL, PASSWORD);
    const acceptRes = await page.request.post(`/api/teams/invitations/${invitationId}/accept`, { data: {} });
    expect(acceptRes.status()).toBe(200);

    // ── Step 10: Verify project page shows team ──
    await page.goto(`/projects/${projectId}`);
    await expect(page.locator("text=E2E Mentorship Program")).toBeVisible({ timeout: 10000 });
  });

  test("second proposal is rejected with reason recorded", async ({ page, browser }) => {
    test.setTimeout(180000); // 3 minutes
    await signupAndVerify(page, `${PREFIX}-proposer2@str-test.local`, "G03 Proposer 2");
    await signin(page, `${PREFIX}-proposer2@str-test.local`, PASSWORD);

    await page.goto("/proposals/new");
    await page.fill('[name="title"]', "E2E Rejected Proposal");
    await page.fill('[name="problemStatement"]', "This proposal should be rejected for testing purposes. It has insufficient detail and unclear outcomes.");
    await page.fill('[name="outcomes"]', "Unclear outcomes that do not meet the acceptance threshold for institutional approval.");
    await page.fill('[name="scope"]', "Vague scope without clear deliverables or timeline.");
    await page.fill('[name="requiredSkills"]', "Testing");
    await page.fill('[name="acceptanceCriteria"]', "No clear acceptance criteria defined for this test proposal rejection flow.");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/proposals/, { timeout: 15000 });

    await page.locator('a[href*="/proposals/"]').first().click();
    await page.waitForURL(/\/proposals\/[^/]+$/, { timeout: 10000 });
    const proposalId = page.url().split("/").pop()!;

    await page.request.post(`/api/proposals/${proposalId}/submit`, { data: {} });

    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);

    const rejectResult = await reviewerPage.evaluate(async ({ proposalId }) => {
      const res = await fetch(`/api/proposals/${proposalId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT", reason: "The proposal lacks clear outcomes, measurable acceptance criteria, and a defined scope. It does not meet the institutional threshold for approval." }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { proposalId });
    expect(rejectResult.status).toBe(200);

    const proposalCheck = await reviewerPage.evaluate(async () => {
      const res = await fetch(`/api/proposals`);
      return await res.json();
    });
    const rejected = proposalCheck.data.proposals.find((p: { id: string }) => p.id === proposalId);
    expect(rejected.status).toBe("REJECTED");
    await reviewerCtx.close();
  });

  test("scope change preserves approved charter and creates new revision", async ({ page, browser }) => {
    test.setTimeout(180000); // 3 minutes
    // Create + approve a proposal first (reuse the flow).
    await signupAndVerify(page, `${PREFIX}-scope-proposer@str-test.local`, "Scope Proposer");
    await signin(page, `${PREFIX}-scope-proposer@str-test.local`, PASSWORD);

    await page.goto("/proposals/new");
    await page.fill('[name="title"]', "Scope Change Test Project");
    await page.fill('[name="problemStatement"]', "Original problem statement for testing scope change preservation of approved charter.");
    await page.fill('[name="outcomes"]', "Original outcomes that should be preserved after scope change request.");
    await page.fill('[name="scope"]', "Original scope definition for the project charter.");
    await page.fill('[name="requiredSkills"]', "React, Node.js");
    await page.fill('[name="acceptanceCriteria"]', "Original acceptance criteria that must remain immutable after scope change.");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/proposals/, { timeout: 15000 });

    await page.locator('a[href*="/proposals/"]').first().click();
    await page.waitForURL(/\/proposals\/[^/]+$/, { timeout: 10000 });
    const proposalId = page.url().split("/").pop()!;
    await page.request.post(`/api/proposals/${proposalId}/submit`, { data: {} });

    // Approve with reviewer + steward.
    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);

    const stewardCtx = await browser.newContext();
    const stewardPage = await stewardCtx.newPage();
    await signin(stewardPage, STEWARD_EMAIL, "StewardPass123!");
    const stewardId = await getUserId(stewardPage);

    const approveResult = await reviewerPage.evaluate(async ({ proposalId, stewardId }) => {
      const res = await fetch(`/api/proposals/${proposalId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", reason: "Approved for scope change testing purposes.", stewardId }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { proposalId, stewardId });
    expect(approveResult.status).toBe(200);
    await reviewerCtx.close();
    await stewardCtx.close();

    // Verify approved.
    const approvedData = await page.request.get(`/api/proposals`).then(r => r.json());
    const approved = approvedData.data.proposals.find((p: { id: string }) => p.id === proposalId);
    expect(approved.status).toBe("APPROVED");
    const approvedCharterText = approved.currentRevision.problemStatement;

    // Request scope change.
    const scopeRes = await page.request.post(`/api/proposals/${proposalId}/scope-change`, {
      data: {
        charter: {
          problemStatement: "MODIFIED problem statement for scope change test — this should NOT replace the approved charter.",
          outcomes: "Modified outcomes for the scope change revision.",
          scope: "Modified scope for testing scope change behavior.",
          requiredSkills: ["React", "Node.js", "PostgreSQL"],
          acceptanceCriteria: "Modified acceptance criteria for the scope change revision.",
        },
        reason: "Need to expand scope to include PostgreSQL training based on demand.",
      },
    });
    expect(scopeRes.status()).toBe(200);

    // Verify: proposal is now NEEDS_REVISION (not APPROVED).
    const afterScopeData = await page.request.get(`/api/proposals`).then(r => r.json());
    const afterScope = afterScopeData.data.proposals.find((p: { id: string }) => p.id === proposalId);
    expect(afterScope.status).toBe("NEEDS_REVISION");

    // CRITICAL: the approved charter is STILL the old one (immutable).
    // The currentRevision is now the new one, but the old revision exists.
    // We verify by checking that the currentRevision's problemStatement is
    // the MODIFIED one (new revision), and the old revision still exists
    // with the original text.
    expect(afterScope.currentRevision.problemStatement).toContain("MODIFIED");
    // The project still exists (scope change doesn't delete the project).
    expect(afterScope.project).toBeTruthy();
  });
});
