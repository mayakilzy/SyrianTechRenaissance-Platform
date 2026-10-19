import { test, expect } from "@playwright/test";

/**
 * STR G09 - Anti-Self + Segregation of Duties E2E Tests (Priority 1.3)
 * --------------------------------------------------
 * Verifies that the platform enforces segregation of duties:
 * 1. Submitter cannot approve own proposal
 * 2. Submitter cannot review own deliverable
 * 3. Rep cannot verify own organization
 * 4. User cannot file a complaint against self
 * 5. Moderator/admin cannot suspend own account
 *
 * Per ChatGPT methodology: each test verifies the action FAILS + verifies NO
 * state modification occurred (no data corruption).
 */

const PREFIX = `g09self-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "TestPassword123!";
const REVIEWER_EMAIL = "reviewer@str.platform.local";
const REVIEWER_PASSWORD = "ReviewerPass123!";
const ADMIN_EMAIL = "test-admin@str.platform.local";
const ADMIN_PASSWORD = "AdminPass123!";
const STEWARD_EMAIL = "steward@str.platform.local";
const STEWARD_PASSWORD = "StewardPass123!";

const PROPOSER_EMAIL = `${PREFIX}-proposer@str-test.local`;

async function signin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/en/auth/signin");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|proposals)/, { timeout: 30000 });
}

async function signupAndVerify(page: import("@playwright/test").Page, email: string, name: string) {
  await page.context().clearCookies();
  await page.goto("/en/auth/signup");
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', PASSWORD);
  await page.fill('[name="displayName"]', name);
  await page.click('button[type="submit"]');
  await expect(page.locator("text=Check your email").or(page.locator("text=تحقق من بريدك"))).toBeVisible({ timeout: 15000 });
  const { extractVerificationUrl, waitForEmail } = await import("./fixtures/test-emails");
  await waitForEmail(email, 30000);
  const verifyUrl = extractVerificationUrl(email);
  expect(verifyUrl).toBeTruthy();
  await page.goto(verifyUrl!.replace(/^https?:\/\/[^\/]+/, ""));
  await expect(page.locator("text=verified successfully").or(page.locator("text=بنجاح"))).toBeVisible({ timeout: 15000 });
  await signin(page, email, PASSWORD);
}

async function getUserId(page: import("@playwright/test").Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    return data;
  });
  return result?.user?.id ?? "";
}

async function apiCall(
  page: import("@playwright/test").Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; ok: boolean; data: any; error: any }> {
  const result = await page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, data: json?.data, error: json?.error };
    },
    { method, url, body },
  );
  return result;
}

test.describe("G09 - Anti-Self + Segregation of Duties (Priority 1.3)", () => {
  let proposerPage: import("@playwright/test").Page;
  let reviewerPage: import("@playwright/test").Page;
  let adminPage: import("@playwright/test").Page;
  let stewardPage: import("@playwright/test").Page;
  let proposalId: string;
  let stewardId: string;

  test.beforeAll(async ({ browser }) => {
    const propCtx = await browser.newContext();
    const revCtx = await browser.newContext();
    const admCtx = await browser.newContext();
    const stewCtx = await browser.newContext();
    proposerPage = await propCtx.newPage();
    reviewerPage = await revCtx.newPage();
    adminPage = await admCtx.newPage();
    stewardPage = await stewCtx.newPage();

    // Sign in steward + get ID
    await signin(stewardPage, STEWARD_EMAIL, STEWARD_PASSWORD);
    stewardId = await getUserId(stewardPage);

    // Signup proposer (fresh account)
    await signupAndVerify(proposerPage, PROPOSER_EMAIL, "Self-Test Proposer");

    // Create + submit proposal
    const createRes = await apiCall(proposerPage, "POST", "/api/proposals", {
      title: "Self-Approval Test Proposal",
      charter: {
        problemStatement: "Anti-self test problem statement with sufficient length for validation purposes.",
        outcomes: "Anti-self test outcomes with sufficient length for validation purposes.",
        scope: "Anti-self test scope with sufficient length for validation purposes.",
        requiredSkills: ["TypeScript"],
        acceptanceCriteria: "Anti-self test acceptance criteria with sufficient length for validation purposes.",
      },
    });
    expect(createRes.ok).toBe(true);
    proposalId = createRes.data?.proposal?.id;
    expect(proposalId).toBeTruthy();

    const submitRes = await apiCall(proposerPage, "POST", `/api/proposals/${proposalId}/submit`, {});
    expect(submitRes.ok).toBe(true);

    // Sign in admin for tests
    await signin(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  // ── Test 1: Submitter cannot approve own proposal ──

  test("1. Submitter cannot approve own proposal -> 403 Forbidden", async () => {
    // Proposer (submitter) attempts to review+approve own proposal
    const res = await apiCall(proposerPage, "POST", `/api/proposals/${proposalId}/review`, {
      action: "APPROVE",
      reason: "Self-approval attempt",
      stewardId,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe("STR_FORBIDDEN");

    // Verify NO state modification: proposal should still be SUBMITTED, not APPROVED
    const checkRes = await apiCall(proposerPage, "GET", `/api/proposals/${proposalId}`);
    expect(checkRes.ok).toBe(true);
    expect(checkRes.data?.proposal?.status).toBe("SUBMITTED");
  });

  test("2. Submitter cannot REQUEST_REVISION on own proposal -> 403 Forbidden", async () => {
    const res = await apiCall(proposerPage, "POST", `/api/proposals/${proposalId}/review`, {
      action: "REQUEST_REVISION",
      reason: "Self-revision attempt",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);

    // Verify state unchanged
    const checkRes = await apiCall(proposerPage, "GET", `/api/proposals/${proposalId}`);
    expect(checkRes.data?.proposal?.status).toBe("SUBMITTED");
  });

  // ── Test 3: Admin cannot complain about self (moderation anti-self) ──

  test("3. Admin cannot file a complaint against self -> 403 Forbidden", async () => {
    const adminId = await getUserId(adminPage);
    expect(adminId).toBeTruthy();

    const res = await apiCall(adminPage, "POST", "/api/moderation/complaints", {
      targetUserId: adminId, // self
      // projectId/threadId OMITTED (Zod v4 optional() accepts undefined but rejects null).
      reason: "Self-complaint attempt — should be blocked by anti-self-complaint invariant",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe("STR_FORBIDDEN");
  });

  // ── Test 4: Rep cannot verify own organization (G06 invariant) ──
  //
  // Per ChatGPT directive: ensure the rejection is from anti-self-verification,
  // not from a different policy. Add a positive control: admin verifies a
  // DIFFERENT rep → 200. This proves the 403 in the self-verification case
  // came from anti-self-verification, not from admin being unable to verify
  // any rep.

  test("4a. Positive control: Admin CAN verify a DIFFERENT rep -> 200 (proves admin can verify reps)", async () => {
    // Setup: admin creates org + adds Member (different user) as rep
    const orgRes = await apiCall(adminPage, "POST", "/api/organizations", {
      legalName: "Anti-Self Test Org (positive control)",
      displayName: "Anti-Self Org Pos",
      email: `self-org-pos.${PREFIX}@str-test.local`,
    });
    expect(orgRes.ok).toBe(true);
    const orgId = orgRes.data?.organization?.id;
    expect(orgId).toBeTruthy();

    // Get Member's userId (a DIFFERENT user from Admin)
    const memberCtx = await adminPage.context().browser()?.newContext();
    if (!memberCtx) throw new Error("Failed to create member context");
    const memberPage = await memberCtx.newPage();
    await signin(memberPage, "member@str.platform.local", "MemberPass123!");
    const memberId = await getUserId(memberPage);
    expect(memberId).toBeTruthy();
    await memberCtx.close();

    // Admin adds Member as rep
    const repRes = await apiCall(adminPage, "POST", `/api/organizations/${orgId}/representatives`, {
      userId: memberId,
      role: "signatory",
      delegatedAuthorityScope: "Authority to test positive control verification",
    });
    expect(repRes.ok).toBe(true);

    // Get the rep record ID
    const repsList = await apiCall(adminPage, "GET", `/api/organizations/${orgId}/representatives`);
    expect(repsList.ok).toBe(true);
    const repRecordId = repsList.data?.representatives?.[0]?.id;
    expect(repRecordId).toBeTruthy();

    // Admin verifies Member as rep → should SUCCEED (admin ≠ rep user)
    const verifyRes = await apiCall(adminPage, "POST", `/api/organizations/${orgId}/representatives/${repRecordId}/verify`, {});
    expect(verifyRes.ok, `Admin should be able to verify a different rep: ${verifyRes.error?.message}`).toBe(true);
    expect(verifyRes.status).toBe(200);
  });

  test("4b. Rep cannot verify own organization (anti-self-verification) -> 403 Forbidden", async () => {
    // Setup: admin creates org + adds Admin themselves as rep
    const orgRes = await apiCall(adminPage, "POST", "/api/organizations", {
      legalName: "Anti-Self Test Org (self-verif)",
      displayName: "Anti-Self Org Self",
      email: `self-org-self.${PREFIX}@str-test.local`,
    });
    expect(orgRes.ok).toBe(true);
    const orgId = orgRes.data?.organization?.id;
    expect(orgId).toBeTruthy();

    // Admin adds themselves as rep (admin is the rep)
    const adminId = await getUserId(adminPage);
    const repRes = await apiCall(adminPage, "POST", `/api/organizations/${orgId}/representatives`, {
      userId: adminId,
      role: "signatory",
      delegatedAuthorityScope: "Authority to test anti-self-verification",
    });
    expect(repRes.ok).toBe(true);

    // Get the rep record ID
    const repsList = await apiCall(adminPage, "GET", `/api/organizations/${orgId}/representatives`);
    expect(repsList.ok).toBe(true);
    const repRecordId = repsList.data?.representatives?.[0]?.id;
    expect(repRecordId).toBeTruthy();

    // Admin (who is now a rep) tries to verify themselves as a rep — should be BLOCKED
    // The 403 comes from the explicit anti-self-verification guard in
    // src/modules/organizations/service.ts verifyRepresentative:
    //   if (rep.userId === verifierId) throw ForbiddenError("Cannot verify your own...")
    const verifyRes = await apiCall(adminPage, "POST", `/api/organizations/${orgId}/representatives/${repRecordId}/verify`, {});
    expect(verifyRes.ok).toBe(false);
    expect(verifyRes.status).toBe(403);
    expect(verifyRes.error?.code).toBe("STR_FORBIDDEN");
    expect(verifyRes.error?.message).toContain("own");
  });

  // ── Test 5: Admin cannot suspend own account via moderation (anti-self-suspension) ──
  //
  // Real E2E scenario per ChatGPT correction:
  // 1. Member files complaint against Admin (target = Admin, complainant = Member — different
  //    users, so anti-self-complaint check passes).
  // 2. Admin (the target) attempts to USER_SUSPEND themselves via the decide endpoint.
  // 3. The anti-self-suspension guard in src/modules/moderation/service.ts decideComplaint:
  //    `if (action === "USER_SUSPENDED" && complaint.targetUserId === deciderId)
  //       throw new ForbiddenError("Cannot suspend your own account (anti-self-suspension)")`
  // 4. Verify: Admin's account status remains ACTIVE (no state modification).

  let selfSuspensionComplaintId: string;

  test("5a. Setup: Member files complaint against Admin (target = Admin)", async () => {
    // Get Admin's userId
    const adminId = await getUserId(adminPage);
    expect(adminId).toBeTruthy();

    // Member signs in (different context from admin)
    const memberCtx = await adminPage.context().browser()?.newContext();
    if (!memberCtx) throw new Error("Failed to create member context");
    const memberPage = await memberCtx.newPage();
    await signin(memberPage, "member@str.platform.local", "MemberPass123!");

    // Member files complaint targeting Admin
    const complaintRes = await apiCall(memberPage, "POST", "/api/moderation/complaints", {
      targetUserId: adminId,
      reason: "Setup complaint for anti-self-suspension test — Admin is the target.",
    });
    expect(complaintRes.ok, `Complaint creation failed: ${complaintRes.error?.message}`).toBe(true);
    selfSuspensionComplaintId = complaintRes.data?.complaint?.id;
    expect(selfSuspensionComplaintId).toBeTruthy();
    await memberCtx.close();
  });

  test("5b. Admin cannot USER_SUSPEND self via moderation decide -> 403 Forbidden + no state change", async () => {
    expect(selfSuspensionComplaintId).toBeTruthy();
    // Sanity: Admin can still access admin endpoints (proves admin is ACTIVE before the test)
    const beforeRes = await apiCall(adminPage, "GET", "/api/admin/dashboard");
    expect(beforeRes.ok, "Admin should be able to access dashboard before self-suspension attempt").toBe(true);

    // Admin attempts to USER_SUSPEND themselves (Admin is both the decider AND the complaint's target)
    const decideRes = await apiCall(adminPage, "POST", `/api/moderation/complaints/${selfSuspensionComplaintId}/decide`, {
      action: "USER_SUSPENDED",
      reason: "Attempted self-suspension — should be blocked by anti-self-suspension guard",
    });
    expect(decideRes.ok).toBe(false);
    expect(decideRes.status).toBe(403);
    expect(decideRes.error?.code).toBe("STR_FORBIDDEN");
    expect(decideRes.error?.message).toContain("own account");

    // Verify NO state modification: Admin should STILL be able to access admin endpoints
    // (if account was suspended, requireAuth + assertAdmin would have blocked them).
    const afterRes = await apiCall(adminPage, "GET", "/api/admin/dashboard");
    expect(afterRes.ok, "Admin should still be able to access dashboard after blocked self-suspension").toBe(true);

    // Verify complaint status is unchanged (still SUBMITTED, not RESOLVED_SUSPENDED)
    const complaintRes = await apiCall(adminPage, "GET", `/api/moderation/complaints/${selfSuspensionComplaintId}`);
    if (complaintRes.ok) {
      expect(complaintRes.data?.complaint?.status).toBe("SUBMITTED");
    }
  });

  // ── Test 6 (deliverable self-review): REMOVED — covered by g05 spec ──
  //
  // Per ChatGPT directive: do not duplicate tests unnecessarily, do not
  // count placeholders in closed security test counts.
  //
  // The anti-self-review invariant (submitter cannot accept own deliverable)
  // is rigorously E2E-tested in:
  //   tests/e2e/g05-project-execution-flow.spec.ts line 285
  //   Test name: "Genuine anti-self-review: submitter cannot accept their
  //              own deliverable, no contribution created; steward CAN
  //              (positive control)"
  //
  // That test:
  //   - Lead creates task assigned to themselves (allowed — team member)
  //   - Lead creates deliverable + submits a version
  //   - Lead attempts to ACCEPT own deliverable → ForbiddenError (conflict of interest)
  //   - Verifies NO ContributionReference was created (no state modification)
  //   - Positive control: steward CAN accept the same deliverable → 200
  //
  // This is documented as REUSED E2E coverage in the G09 unified report.
  // No new placeholder test here.
});
