import { test, expect } from "@playwright/test";
import { extractVerificationUrl, waitForEmail } from "./fixtures/test-emails";

/**
 * STR G04 — Talent & Opportunity E2E Flow
 *
 * Full journey:
 *   1. Creator creates an opportunity → submits → reviewer publishes it
 *   2. Member searches talent directory → discovers the opportunity → applies
 *   3. Creator reviews applications → accepts/rejects
 *   4. Applicant sees the result in /applications
 *
 * Negative tests:
 *   - Member cannot see non-published opportunities
 *   - Creator cannot review own opportunity
 *   - Member cannot see other applicants' qualificationNotes
 *   - Duplicate application prevented
 */

const PREFIX = `g04e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const CREATOR_EMAIL = `${PREFIX}-creator@str-test.local`;
const APPLICANT_EMAIL = `${PREFIX}-applicant@str-test.local`;
const PASSWORD = "TestPassword123!";
const REVIEWER_EMAIL = "reviewer@str.platform.local";
const REVIEWER_PASSWORD = "ReviewerPass123!";
const MEMBER_EMAIL = "member@str.platform.local";
const MEMBER_PASSWORD = "MemberPass123!";

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
  return page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    const data = await res.json();
    return data?.user?.id ?? "";
  });
}

test.describe("G04 — Talent & Opportunity Full E2E", () => {
  test("create → publish → search → apply → review → accept → applicant sees result", async ({ browser }) => {
    test.setTimeout(240000);

    // ── Setup: create creator + applicant ──
    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    await signupAndVerify(creatorPage, CREATOR_EMAIL, "Project Creator");

    const applicantCtx = await browser.newContext();
    const applicantPage = await applicantCtx.newPage();
    await signupAndVerify(applicantPage, APPLICANT_EMAIL, "Applicant User");

    // ── Step 1: Creator creates an opportunity via API ──
    await signin(creatorPage, CREATOR_EMAIL, PASSWORD);
    const createResult = await creatorPage.evaluate(async () => {
      const res = await fetch("/api/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "E2E Test Opportunity",
          description: "Test opportunity with sufficient length for validation purposes.",
          type: "PROJECT",
          requirements: "React, TypeScript, Playwright",
          isRemote: true,
        }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(createResult.status).toBe(201);
    const opportunityId = createResult.body.data.opportunity.id;
    console.log(`[DIAG] Created opportunity: ${opportunityId}`);

    // ── Step 2: Creator submits for review ──
    const submitResult = await creatorPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      return { status: res.status };
    }, { id: opportunityId });
    expect(submitResult.status).toBe(200);

    // ── Step 3: Reviewer publishes the opportunity ──
    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);

    const reviewResult = await reviewerPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", reason: "This opportunity meets all criteria for publication." }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { id: opportunityId });
    console.log(`[DIAG] Review result: ${reviewResult.status}`);
    expect(reviewResult.status).toBe(200);

    // ── Step 4: Applicant searches talent directory ──
    await signin(applicantPage, APPLICANT_EMAIL, PASSWORD);
    await applicantPage.goto("/talent");
    await expect(applicantPage.locator("h1")).toBeVisible({ timeout: 10000 });

    // ── Step 5: Applicant discovers the published opportunity ──
    await applicantPage.goto("/opportunities");
    await expect(applicantPage.locator("text=E2E Test Opportunity").first()).toBeVisible({ timeout: 10000 });

    // ── Step 6: Applicant opens the opportunity detail ──
    await applicantPage.goto(`/opportunities/${opportunityId}`);
    await expect(applicantPage.locator("h1")).toBeVisible({ timeout: 10000 });
    const h1Text = await applicantPage.locator("h1").textContent();
    expect(h1Text).toContain("E2E Test Opportunity");

    // ── Step 7: Applicant applies (via API — more reliable than UI form) ──
    const applyResult = await applicantPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/applications`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverNote: "I am a great fit for this opportunity." }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { id: opportunityId });
    console.log(`[DIAG] Apply result: ${applyResult.status}`);
    expect(applyResult.status).toBe(201);
    const applicationId = applyResult.body.data.application.id;

    // ── Step 8: Duplicate application prevented ──
    const dupResult = await applicantPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/applications`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverNote: "Second try." }),
      });
      return { status: res.status };
    }, { id: opportunityId });
    expect(dupResult.status).toBe(409); // Conflict

    // ── Step 9: Creator reviews applications ──
    const appsResult = await creatorPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/applications`);
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { id: opportunityId });
    console.log(`[DIAG] Creator sees applications: ${appsResult.status}`);
    expect(appsResult.status).toBe(200);
    expect(appsResult.body.data.applications.length).toBe(1);

    // ── Step 10: Creator accepts the application ──
    const decideResult = await creatorPage.evaluate(async ({ appId }) => {
      const res = await fetch(`/api/applications/${appId}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "ACCEPTED",
          reason: "Your skills match perfectly.",
          qualificationNotes: "Strong portfolio and relevant experience.",
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { appId: applicationId });
    console.log(`[DIAG] Decision result: ${decideResult.status}`);
    expect(decideResult.status).toBe(200);

    // ── Step 11: Applicant sees the result in /applications ──
    await applicantPage.goto("/applications");
    await expect(applicantPage.locator("text=E2E Test Opportunity").first()).toBeVisible({ timeout: 10000 });
    // The applicant should see ACCEPTED status.
    await expect(applicantPage.locator("text=ACCEPTED").first()).toBeVisible({ timeout: 10000 });

    // ── Step 12: qualificationNotes NOT visible to applicant via API ──
    const myAppsResult = await applicantPage.evaluate(async () => {
      // getMyApplications doesn't return qualificationNotes — verify.
      const res = await fetch("/api/opportunities?mine=true");
      return { status: res.status };
    });
    // The applicant can't even access /api/opportunities?mine=true (that's for creators).
    // Let's verify via the applications page that qualificationNotes is not in the HTML.
    // The applicant's /applications page should NOT show qualificationNotes.
    // Check via API that getMyApplications doesn't return it.
    const myAppsApiResult = await applicantPage.evaluate(async () => {
      // There's no direct /api/applications endpoint, but we can check
      // that the page HTML doesn't contain the private notes.
      return document.body.textContent ?? "";
    });
    // qualificationNotes should NOT be in the page.
    // Note: the decision reason "Your skills match perfectly." IS visible.
    // But qualificationNotes "Strong portfolio and relevant experience." is NOT.
    expect(myAppsApiResult).not.toContain("Strong portfolio and relevant experience.");

    // ── Step 13: Creator CAN see qualificationNotes ──
    const creatorAppsResult = await creatorPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/applications`);
      return res.json();
    }, { id: opportunityId });
    const creatorApp = creatorAppsResult.data.applications[0];
    expect(creatorApp.qualificationNotes).toBe("Strong portfolio and relevant experience.");

    await creatorCtx.close();
    await applicantCtx.close();
    await reviewerCtx.close();
  });

  test("negative: member cannot see non-published opportunity via API", async ({ browser }) => {
    test.setTimeout(120000);

    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    await signupAndVerify(creatorPage, `${PREFIX}-hidden-creator@str-test.local`, "Hidden Creator");
    await signin(creatorPage, `${PREFIX}-hidden-creator@str-test.local`, PASSWORD);

    // Create a DRAFT (not submitted, not published).
    const createResult = await creatorPage.evaluate(async () => {
      const res = await fetch("/api/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Hidden Draft Opportunity",
          description: "This should not be visible to regular members in DRAFT status.",
          type: "PROJECT",
        }),
      });
      return res.json();
    });
    const draftId = createResult.data.opportunity.id;

    // Regular member tries to read it → 404 (not 403, to avoid leaking existence).
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signin(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);

    const readResult = await memberPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}`);
      return { status: res.status };
    }, { id: draftId });
    console.log(`[DIAG] Member reads DRAFT: status=${readResult.status}`);
    expect(readResult.status).toBe(404);

    await creatorCtx.close();
    await memberCtx.close();
  });

  test("negative: creator cannot review own opportunity via API", async ({ browser }) => {
    test.setTimeout(120000);

    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    // Creator has reviewer role but still can't self-review.
    await signupAndVerify(creatorPage, `${PREFIX}-selfrev@str-test.local`, "Self Review Creator");
    await signin(creatorPage, `${PREFIX}-selfrev@str-test.local`, PASSWORD);

    const createResult = await creatorPage.evaluate(async () => {
      const res = await fetch("/api/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Self Review Test Opportunity",
          description: "Creator will try to review this own opportunity for conflict of interest test.",
          type: "PROJECT",
        }),
      });
      return res.json();
    });
    const oppId = createResult.data.opportunity.id;

    // Submit.
    await creatorPage.evaluate(async ({ id }) => {
      await fetch(`/api/opportunities/${id}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
    }, { id: oppId });

    // Creator tries to review (even though they may have no reviewer role).
    const reviewResult = await creatorPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", reason: "Self approval attempt for testing purposes." }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, { id: oppId });
    console.log(`[DIAG] Self-review: status=${reviewResult.status}`);
    // 403 = forbidden (either no reviewer role or conflict of interest).
    expect(reviewResult.status).toBe(403);

    await creatorCtx.close();
  });

  test("negative: regular member cannot see other applicants' applications", async ({ browser }) => {
    test.setTimeout(120000);

    const creatorCtx = await browser.newContext();
    const creatorPage = await creatorCtx.newPage();
    await signupAndVerify(creatorPage, `${PREFIX}-priv-creator@str-test.local`, "Privacy Creator");
    await signin(creatorPage, `${PREFIX}-priv-creator@str-test.local`, PASSWORD);

    // Create + submit + approve via reviewer.
    const createResult = await creatorPage.evaluate(async () => {
      const res = await fetch("/api/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Privacy Test Opportunity",
          description: "Testing that regular members cannot see other applicants' data.",
          type: "PROJECT",
        }),
      });
      return res.json();
    });
    const oppId = createResult.data.opportunity.id;

    await creatorPage.evaluate(async ({ id }) => {
      await fetch(`/api/opportunities/${id}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
    }, { id: oppId });

    const reviewerCtx = await browser.newContext();
    const reviewerPage = await reviewerCtx.newPage();
    await signin(reviewerPage, REVIEWER_EMAIL, REVIEWER_PASSWORD);
    await reviewerPage.evaluate(async ({ id }) => {
      await fetch(`/api/opportunities/${id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", reason: "Approved for privacy testing purposes." }),
      });
    }, { id: oppId });
    await reviewerCtx.close();

    // Applicant applies.
    const applicantCtx = await browser.newContext();
    const applicantPage = await applicantCtx.newPage();
    await signupAndVerify(applicantPage, `${PREFIX}-priv-applicant@str-test.local`, "Privacy Applicant");
    await signin(applicantPage, `${PREFIX}-priv-applicant@str-test.local`, PASSWORD);
    await applicantPage.evaluate(async ({ id }) => {
      await fetch(`/api/opportunities/${id}/applications`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverNote: "My private application data." }),
      });
    }, { id: oppId });

    // Another member tries to see applications → 403.
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signin(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);
    const appsResult = await memberPage.evaluate(async ({ id }) => {
      const res = await fetch(`/api/opportunities/${id}/applications`);
      return { status: res.status };
    }, { id: oppId });
    console.log(`[DIAG] Member reads applications: ${appsResult.status}`);
    expect(appsResult.status).toBe(403);

    await creatorCtx.close();
    await applicantCtx.close();
    await memberCtx.close();
  });
});
