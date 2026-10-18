import { test, expect } from "@playwright/test";

/**
 * STR G05 — Project Execution Full E2E Flow (CORRECTED EVIDENCE)
 *
 * Per MASTER's "G05 — FINAL ACCEPTANCE EVIDENCE CORRECTION" directive:
 *
 *   1. Full Team Workflow (per official G05 acceptance criteria):
 *      Lead assigns task → Team Member submits → Reviewer requests changes
 *      → Member resubmits → Reviewer accepts → ContributionReference recorded.
 *      The member must be a real, independent team participant (joined via the
 *      G03 team-invite flow). The contribution must be recorded under the
 *      MEMBER's user ID, not the lead's.
 *
 *   2. Genuine Anti-Self-Review Test:
 *      The submitter of a deliverable attempts to ACCEPT their own deliverable.
 *      The actor must have a role that would otherwise permit review (lead or
 *      steward). The service must block the operation and NO ContributionReference
 *      must be created. A positive control proves the only block was the
 *      anti-self-review guard (steward CAN accept the same deliverable).
 *
 *   3. Cross-project access denied:
 *      The previous "anti-self-review" test actually tested 404 on a
 *      non-existent project. Renamed to reflect what it tests.
 *
 * Uses pre-seeded institutional accounts (reviewer@str.platform.local,
 * steward@str.platform.local) plus freshly-signed-up users for lead + member.
 */

const REVIEWER_EMAIL = "reviewer@str.platform.local";
const REVIEWER_PASSWORD = "ReviewerPass123!";
const STEWARD_EMAIL = "steward@str.platform.local";
const STEWARD_PASSWORD = "StewardPass123!";

const PREFIX = `g05e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const LEAD_EMAIL = `${PREFIX}-lead@str-test.local`;
const MEMBER_EMAIL = `${PREFIX}-member@str-test.local`;
const PASSWORD = "TestPassword123!";

interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

async function apiCall(
  page: import("@playwright/test").Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<ApiResult> {
  const { status, json } = await page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    data: json?.data,
    error: json?.error,
  };
}

async function signin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/auth/signin");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|en\/dashboard)/, { timeout: 30000 }).catch(() => {});
}

async function getUserId(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    return data?.user?.id ?? "";
  });
}

async function signupAndVerify(page: import("@playwright/test").Page, email: string, name: string) {
  await page.goto("/auth/signup");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', PASSWORD);
  await page.fill('[name="displayName"]', name);
  await page.click('button[type="submit"]');
  const { extractVerificationUrl, waitForEmail } = await import("./fixtures/test-emails");
  await waitForEmail(email, 30000);
  const verifyUrl = extractVerificationUrl(email);
  expect(verifyUrl).toBeTruthy();
  await page.goto(verifyUrl!.replace(/^https?:\/\/[^/]+/, ""));
  await signin(page, email, PASSWORD);
}

test.describe("G05 — Project Execution Full E2E (Corrected Evidence)", () => {
  test(
    "Full team workflow: lead → member submits → reviewer requests changes → member resubmits → reviewer accepts → contribution recorded under MEMBER",
    async ({ browser }) => {
      test.setTimeout(360000); // 6 minutes — full lifecycle with team-invite

      // ── Contexts ──
      const reviewerCtx = await browser.newContext();
      const reviewerPage = await reviewerCtx.newPage();
      const stewardCtx = await browser.newContext();
      const stewardPage = await stewardCtx.newPage();
      const leadCtx = await browser.newContext();
      const leadPage = await leadCtx.newPage();
      const memberCtx = await browser.newContext();
      const memberPage = await memberCtx.newPage();

      // ── Setup: signup lead + member (fresh accounts, verified) ──
      await signupAndVerify(leadPage, LEAD_EMAIL, "Project Lead");
      await signupAndVerify(memberPage, MEMBER_EMAIL, "Project Member");

      const leadUserId = await getUserId(leadPage);
      const memberUserId = await getUserId(memberPage);
      expect(leadUserId).toBeTruthy();
      expect(memberUserId).toBeTruthy();
      expect(leadUserId).not.toBe(memberUserId);

      // Sign in steward to get their user ID
      await signin(stewardPage, STEWARD_EMAIL, STEWARD_PASSWORD);
      const stewardUserId = await getUserId(stewardPage);
      expect(stewardUserId).toBeTruthy();
      expect(stewardUserId).not.toBe(leadUserId);
      expect(stewardUserId).not.toBe(memberUserId);

      // ── Step 1: Lead creates + submits a proposal via API ──
      await signin(leadPage, LEAD_EMAIL, PASSWORD);
      const proposalRes = await apiCall(leadPage, "POST", "/api/proposals", {
        title: `E2E Project ${PREFIX}`,
        charter: {
          problemStatement: "E2E test problem statement with sufficient length for validation purposes.",
          outcomes: "E2E test outcomes with sufficient length for validation purposes.",
          scope: "E2E test scope with sufficient length for validation purposes.",
          requiredSkills: ["TypeScript", "Playwright"],
          acceptanceCriteria: "E2E test acceptance criteria with sufficient length for validation purposes.",
        },
      });
      expect(proposalRes.ok, `Proposal creation failed: ${proposalRes.error?.message}`).toBe(true);
      const proposalId = proposalRes.data?.proposal?.id;
      expect(proposalId).toBeTruthy();

      const submitRes = await apiCall(leadPage, "POST", `/api/proposals/${proposalId}/submit`, {});
      expect(submitRes.ok, `Submit failed: ${submitRes.error?.message}`).toBe(true);

      // ── Step 2: Reviewer approves with stewardId ──
      await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);
      const approveRes = await apiCall(reviewerPage, "POST", `/api/proposals/${proposalId}/review`, {
        action: "APPROVE",
        reason: "E2E test approval for acceptance evidence.",
        stewardId: stewardUserId,
      });
      expect(approveRes.ok, `Approval failed: ${approveRes.error?.message}`).toBe(true);

      // ── Step 3: Fetch the project ID + team ID (created atomically on approval) ──
      let projectId: string | undefined;
      let teamId: string | undefined;
      const propDetail = await apiCall(reviewerPage, "GET", `/api/proposals/${proposalId}`);
      projectId = propDetail.data?.proposal?.project?.id;
      teamId = propDetail.data?.proposal?.project?.team?.id;
      if (!projectId || !teamId) {
        console.log("Proposal detail project field:", JSON.stringify(propDetail.data?.proposal?.project));
      }
      expect(projectId, "Project ID should be available after approval").toBeTruthy();
      expect(teamId, "Team ID should be available after approval").toBeTruthy();

      // ── Step 4: Lead invites the member to the team (G03 team-invite flow) ──
      const inviteRes = await apiCall(leadPage, "POST", `/api/teams/${teamId}/invite`, {
        inviteeId: memberUserId,
        role: "MEMBER",
      });
      expect(inviteRes.ok, `Invite failed: ${inviteRes.error?.message}`).toBe(true);
      const invitationId = inviteRes.data?.invitation?.id;
      expect(invitationId).toBeTruthy();

      // ── Step 5: Member accepts the invitation (becomes a real team participant) ──
      await signin(memberPage, MEMBER_EMAIL, PASSWORD);
      const acceptRes = await apiCall(memberPage, "POST", `/api/teams/invitations/${invitationId}/accept`, {});
      expect(acceptRes.ok, `Accept invitation failed: ${acceptRes.error?.message}`).toBe(true);

      // ── Step 6: Lead creates a milestone ──
      const milestoneRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/milestones`, {
        title: "E2E Milestone",
        description: "Milestone for the full team workflow E2E test.",
      });
      expect(milestoneRes.ok, `Milestone creation failed: ${milestoneRes.error?.message}`).toBe(true);
      const milestoneId = milestoneRes.data?.milestone?.id;
      expect(milestoneId).toBeTruthy();

      // ── Step 7: Lead creates a task — assigned to MEMBER (not self) ──
      const taskRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/tasks`, {
        title: "E2E Task",
        description: "Task for testing the full team workflow with an independent member.",
        assigneeId: memberUserId,
        milestoneId,
      });
      expect(taskRes.ok, `Task creation failed: ${taskRes.error?.message}`).toBe(true);
      const taskId = taskRes.data?.task?.id;
      expect(taskId).toBeTruthy();
      expect(taskRes.data?.task?.assigneeId).toBe(memberUserId);

      // ── Step 8: Member accepts the task ──
      const acceptTaskRes = await apiCall(memberPage, "POST", `/api/projects/${projectId}/tasks/${taskId}/accept`, {});
      expect(acceptTaskRes.ok, `Task accept failed: ${acceptTaskRes.error?.message}`).toBe(true);

      // ── Step 9: Member creates a deliverable ──
      const deliverableRes = await apiCall(memberPage, "POST", `/api/projects/${projectId}/deliverables`, {
        taskId,
      });
      expect(deliverableRes.ok, `Deliverable creation failed: ${deliverableRes.error?.message}`).toBe(true);
      const deliverableId = deliverableRes.data?.deliverable?.id;
      expect(deliverableId).toBeTruthy();

      // ── Step 10: Member submits version 1 ──
      const v1Res = await apiCall(memberPage, "POST", `/api/projects/${projectId}/deliverables/${deliverableId}/versions`, {
        textContent: "Version 1 — initial submission from the team member, not the lead.",
        notes: "First draft submitted by the independent team member.",
      });
      expect(v1Res.ok, `Version 1 submit failed: ${v1Res.error?.message}`).toBe(true);
      expect(v1Res.data?.version?.versionNumber).toBe(1);

      // ── Step 11: Steward reviews + REQUEST_CHANGES (steward ≠ member, so no conflict) ──
      await signin(stewardPage, STEWARD_EMAIL, STEWARD_PASSWORD);
      const review1Res = await apiCall(stewardPage, "POST", `/api/projects/${projectId}/deliverables/${deliverableId}/review`, {
        action: "REQUEST_CHANGES",
        reason: "Please add more detail about the implementation approach in the deliverable.",
      });
      expect(review1Res.ok, `Review 1 (REQUEST_CHANGES) failed: ${review1Res.error?.message}`).toBe(true);
      expect(review1Res.data?.review?.newDeliverableStatus).toBe("CHANGES_REQUESTED");

      // ── Step 12: Member resubmits version 2 ──
      await signin(memberPage, MEMBER_EMAIL, PASSWORD);
      const v2Res = await apiCall(memberPage, "POST", `/api/projects/${projectId}/deliverables/${deliverableId}/versions`, {
        textContent: "Version 2 — added implementation details and resolved the requested changes.",
        notes: "Revised submission addressing the steward's feedback.",
      });
      expect(v2Res.ok, `Version 2 submit failed: ${v2Res.error?.message}`).toBe(true);
      expect(v2Res.data?.version?.versionNumber).toBe(2);

      // ── Step 13: Steward reviews + ACCEPTS version 2 ──
      await signin(stewardPage, STEWARD_EMAIL, STEWARD_PASSWORD);
      const review2Res = await apiCall(stewardPage, "POST", `/api/projects/${projectId}/deliverables/${deliverableId}/review`, {
        action: "ACCEPT",
        reason: "Version 2 addresses all requested changes. The member's contribution is accepted.",
      });
      expect(review2Res.ok, `Review 2 (ACCEPT) failed: ${review2Res.error?.message}`).toBe(true);
      expect(review2Res.data?.review?.newDeliverableStatus).toBe("ACCEPTED");
      expect(review2Res.data?.review?.contributionId).toBeTruthy();
      expect(review2Res.data?.review?.attributionText).toContain("contributed to");

      // ── Step 14: Verify ContributionReference was recorded UNDER THE MEMBER ──
      await signin(leadPage, LEAD_EMAIL, PASSWORD);
      const contribRes = await apiCall(leadPage, "GET", `/api/projects/${projectId}/contributions`);
      expect(contribRes.ok, `Contributions fetch failed: ${contribRes.error?.message}`).toBe(true);
      expect(contribRes.data?.contributions?.length).toBe(1);
      const contribution = contribRes.data?.contributions?.[0];
      expect(contribution?.contributorId, "Contribution must be recorded under the MEMBER, not the lead").toBe(memberUserId);
      expect(contribution?.contributorId, "Contribution must NOT be the lead").not.toBe(leadUserId);
      expect(contribution?.acceptedById, "Contribution acceptedBy must be the steward").toBe(stewardUserId);
      expect(contribution?.acceptedVersion).toBe(2);

      // ── Step 15: Member views their contributions page (UI verification) ──
      await signin(memberPage, MEMBER_EMAIL, PASSWORD);
      await memberPage.goto("/projects/me/contributions");
      // The page should show the project — verify by PREFIX (unique per test run)
      await expect(memberPage.locator(`text=${PREFIX}`).first()).toBeVisible({ timeout: 15000 });

      // ── Step 16: Verify project workspace shows the accepted deliverable by member ──
      const finalWorkspaceRes = await apiCall(leadPage, "GET", `/api/projects/${projectId}/workspace`);
      expect(finalWorkspaceRes.data?.recentDeliverables?.[0]?.status).toBe("ACCEPTED");
      expect(finalWorkspaceRes.data?.contributionsCount).toBe(1);
      expect(finalWorkspaceRes.data?.recentDeliverables?.[0]?.submitter?.id).toBe(memberUserId);
    },
  );

  test(
    "Genuine anti-self-review: submitter cannot accept their own deliverable, no contribution created; steward CAN (positive control)",
    async ({ browser }) => {
      test.setTimeout(300000); // 5 minutes

      /**
       * Scenario:
       *   - Lead creates a task assigned to themselves (allowed — they're a team member)
       *   - Lead creates a deliverable + submits a version
       *   - Lead (who IS the lead AND the task assignee) attempts to ACCEPT their own
       *     deliverable via the API. The service must reject with ForbiddenError because
       *     `task.assigneeId === reviewerId` (conflict of interest).
       *   - Verify NO ContributionReference was created.
       *   - Positive control: steward CAN accept the same deliverable — proves the only
       *     thing blocking the lead was the anti-self-review guard, not a general
       *     permission issue.
       */

      const reviewerCtx = await browser.newContext();
      const reviewerPage = await reviewerCtx.newPage();
      const stewardCtx = await browser.newContext();
      const stewardPage = await stewardCtx.newPage();
      const leadCtx = await browser.newContext();
      const leadPage = await leadCtx.newPage();

      // ── Setup: signup lead + verify ──
      const selfLeadEmail = `${PREFIX}-self-lead@str-test.local`;
      await signupAndVerify(leadPage, selfLeadEmail, "Self Review Lead");

      const leadUserId = await getUserId(leadPage);
      expect(leadUserId).toBeTruthy();

      // Sign in steward to get their user ID
      await signin(stewardPage, STEWARD_EMAIL, STEWARD_PASSWORD);
      const stewardUserId = await getUserId(stewardPage);
      expect(stewardUserId).toBeTruthy();
      expect(stewardUserId).not.toBe(leadUserId);

      // ── Step 1: Lead creates + submits a proposal ──
      await signin(leadPage, selfLeadEmail, PASSWORD);
      const proposalRes = await apiCall(leadPage, "POST", "/api/proposals", {
        title: `Self-Review Test ${PREFIX}`,
        charter: {
          problemStatement: "Self-review test problem statement with sufficient length for validation.",
          outcomes: "Self-review test outcomes with sufficient length for validation.",
          scope: "Self-review test scope with sufficient length for validation.",
          requiredSkills: ["TypeScript"],
          acceptanceCriteria: "Self-review test acceptance criteria with sufficient length.",
        },
      });
      expect(proposalRes.ok, `Proposal creation failed: ${proposalRes.error?.message}`).toBe(true);
      const proposalId = proposalRes.data?.proposal?.id;
      expect(proposalId).toBeTruthy();

      await apiCall(leadPage, "POST", `/api/proposals/${proposalId}/submit`, {});

      // ── Step 2: Reviewer approves with steward ──
      await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);
      const approveRes = await apiCall(reviewerPage, "POST", `/api/proposals/${proposalId}/review`, {
        action: "APPROVE",
        reason: "Approved for self-review E2E test.",
        stewardId: stewardUserId,
      });
      expect(approveRes.ok).toBe(true);

      // ── Step 3: Get project + team IDs ──
      const propDetail = await apiCall(reviewerPage, "GET", `/api/proposals/${proposalId}`);
      const projectId = propDetail.data?.proposal?.project?.id;
      const teamId = propDetail.data?.proposal?.project?.team?.id;
      expect(projectId).toBeTruthy();
      expect(teamId).toBeTruthy();

      // ── Step 4: Lead creates a task ASSIGNED TO THEMSELVES ──
      // Lead is automatically a team member with role LEAD, so they can be an assignee.
      await signin(leadPage, selfLeadEmail, PASSWORD);
      const taskRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/tasks`, {
        title: "Self-review test task",
        description: "Task assigned to the lead themselves to test the anti-self-review guard.",
        assigneeId: leadUserId,
      });
      expect(taskRes.ok, `Task creation failed: ${taskRes.error?.message}`).toBe(true);
      const taskId = taskRes.data?.task?.id;
      expect(taskId).toBeTruthy();
      expect(taskRes.data?.task?.assigneeId).toBe(leadUserId);

      // ── Step 5: Lead accepts the task ──
      await apiCall(leadPage, "POST", `/api/projects/${projectId}/tasks/${taskId}/accept`, {});

      // ── Step 6: Lead creates a deliverable + submits version 1 ──
      const deliverableRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/deliverables`, {
        taskId,
      });
      expect(deliverableRes.ok).toBe(true);
      const deliverableId = deliverableRes.data?.deliverable?.id;
      expect(deliverableId).toBeTruthy();

      const v1Res = await apiCall(leadPage, "POST", `/api/projects/${projectId}/deliverables/${deliverableId}/versions`, {
        textContent: "My own deliverable that I will try to self-accept.",
        notes: "Submission for the anti-self-review test.",
      });
      expect(v1Res.ok).toBe(true);

      // ── Step 7: Lead attempts to ACCEPT their own deliverable ──
      // The lead has the authority to review (isLead=true), but the anti-self-review
      // guard (task.assigneeId === reviewerId) must block this.
      const selfAcceptRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/deliverables/${deliverableId}/review`, {
        action: "ACCEPT",
        reason: "Trying to accept my own deliverable. Should be blocked by the anti-self-review guard.",
      });
      expect(selfAcceptRes.ok, "Self-accept should be blocked").toBe(false);
      expect(selfAcceptRes.status, "Self-accept should return 403 Forbidden").toBe(403);
      expect(selfAcceptRes.error?.code).toBe("STR_FORBIDDEN");
      expect(selfAcceptRes.error?.message).toMatch(/conflict of interest|cannot review your own/i);

      // ── Step 8: Verify NO ContributionReference was created ──
      const contribRes = await apiCall(leadPage, "GET", `/api/projects/${projectId}/contributions`);
      expect(contribRes.ok).toBe(true);
      expect(contribRes.data?.contributions?.length, "No contribution should exist after a blocked self-review").toBe(0);

      // ── Step 9: Verify the deliverable is still in SUBMITTED status (not ACCEPTED) ──
      const deliverableDetail = await apiCall(leadPage, "GET", `/api/projects/${projectId}/deliverables/${deliverableId}`);
      expect(deliverableDetail.data?.deliverable?.status).toBe("SUBMITTED");
      expect(deliverableDetail.data?.deliverable?.contribution).toBeNull();

      // ── Step 10: Steward CAN accept the deliverable (positive control) ──
      // This proves the only thing blocking the lead was the anti-self-review guard,
      // not a general permission issue.
      await signin(stewardPage, STEWARD_EMAIL, STEWARD_PASSWORD);
      const stewardAcceptRes = await apiCall(stewardPage, "POST", `/api/projects/${projectId}/deliverables/${deliverableId}/review`, {
        action: "ACCEPT",
        reason: "Steward accepts the lead's deliverable — proves the anti-self-review guard was the only block.",
      });
      expect(stewardAcceptRes.ok, `Steward should be able to accept (positive control): ${stewardAcceptRes.error?.message}`).toBe(true);
      expect(stewardAcceptRes.data?.review?.contributionId).toBeTruthy();

      // ── Step 11: Verify ContributionReference NOW exists (after steward's acceptance) ──
      const contribRes2 = await apiCall(leadPage, "GET", `/api/projects/${projectId}/contributions`);
      expect(contribRes2.data?.contributions?.length).toBe(1);
      expect(contribRes2.data?.contributions?.[0]?.contributorId).toBe(leadUserId);
      expect(contribRes2.data?.contributions?.[0]?.acceptedById).toBe(stewardUserId);
    },
  );

  test(
    "Cross-project access denied: regular user gets 404 for non-existent project workspace",
    async ({ browser }) => {
      /**
       * Renamed from the previous "anti-self-review" test which actually tested
       * 404 on a non-existent project. This is the cross-project access control
       * negative path: a regular authenticated user (no project role) cannot
       * see another project's workspace — the service returns 404 (NOT 403)
       * to avoid leaking the existence of projects the user doesn't belong to.
       */
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await signin(page, "member@str.platform.local", "MemberPass123!");
      const res = await apiCall(page, "GET", "/api/projects/nonexistent-id-12345/workspace");
      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
      expect(res.error?.code).toBe("STR_NOT_FOUND");
    },
  );
});
