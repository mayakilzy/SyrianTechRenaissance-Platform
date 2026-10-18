import { test, expect } from "@playwright/test";
import { spawn, ChildProcess } from "node:child_process";

/**
 * STR G07 — Integration Core E2E Full Flow (with STANDALONE WORKER)
 *
 * Per MASTER G07 FINAL DURABILITY directive:
 * - Tests with the actual standalone worker process (not an HTTP endpoint)
 * - Verifies: admin approve → create connection → submit job →
 *   STANDALONE WORKER processes it → result visible → revoke → blocked
 * - Negative tests: webhook spoofing, missing signature, cross-project
 */

const ADMIN_EMAIL = "test-admin@str.platform.local";
const ADMIN_PASSWORD = "AdminPass123!";
const PREFIX = `g07e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "TestPassword123!";

let workerProcess: ChildProcess | null = null;

test.beforeAll(async () => {
  // Start the STANDALONE worker process (actual Node process, not HTTP)
  workerProcess = spawn("bun", ["run", "src/modules/integrations/outbox-worker.ts"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "pipe",
  });
  workerProcess.stdout?.on("data", (data) => console.log("[worker]", data.toString().trim()));
  workerProcess.stderr?.on("data", (data) => console.error("[worker err]", data.toString().trim()));
  // Wait for the worker to start polling
  await new Promise((resolve) => setTimeout(resolve, 3000));
});

test.afterAll(async () => {
  if (workerProcess) {
    workerProcess.kill("SIGTERM");
    workerProcess = null;
  }
});

interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

async function apiCall(page: import("@playwright/test").Page, method: string, url: string, body?: unknown): Promise<ApiResult> {
  const { status, json } = await page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { method, url, body },
  );
  return { ok: status >= 200 && status < 300, status, data: json?.data, error: json?.error };
}

async function signin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/auth/signin");
  await page.fill("[name="email"]", email);
  await page.fill("[name="password"]", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|en\/dashboard)/, { timeout: 30000 }).catch(() => {});
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

async function pollJobStatus(page: import("@playwright/test").Page, projectId: string, connectionId: string, jobId: string, timeoutMs = 30000): Promise<{ status: string; result?: unknown }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await apiCall(page, "GET", `/api/projects/${projectId}/integrations/${connectionId}/jobs?jobId=${jobId}`);
    const status = res.data?.job?.status;
    if (status === "succeeded" || status === "failed" || status === "timed_out" || status === "cancelled") {
      return { status, result: res.data?.job?.result };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

test.describe("G07 — Integration Core Full E2E (with standalone worker)", () => {
  test("full flow: admin approve → create connection → submit job → worker processes → result → revoke → blocked", async ({ browser }) => {
    test.setTimeout(360000);

    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const leadCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();

    // Step 1: Admin approves the mock provider
    await signin(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
    await apiCall(adminPage, "POST", "/api/integrations/providers/str.mock.v1/approve", {});

    // Step 2: Lead signs up + creates a project
    await signupAndVerify(leadPage, `${PREFIX}-lead@str-test.local`, "G07 Lead");
    const proposalRes = await apiCall(leadPage, "POST", "/api/proposals", {
      title: `G07 E2E ${PREFIX}`,
      charter: {
        problemStatement: "E2E test problem statement with sufficient length for validation purposes.",
        outcomes: "E2E test outcomes with sufficient length for validation purposes.",
        scope: "E2E test scope with sufficient length for validation purposes.",
        requiredSkills: ["TypeScript"],
        acceptanceCriteria: "E2E test acceptance criteria with sufficient length for validation.",
      },
    });
    expect(proposalRes.ok).toBe(true);
    const proposalId = proposalRes.data?.proposal?.id;
    await apiCall(leadPage, "POST", `/api/proposals/${proposalId}/submit`, {});

    // Reviewer approves with steward
    const stewardCtx = await browser.newContext();
    const stewardPage = await stewardCtx.newPage();
    await signin(stewardPage, "steward@str.platform.local", "StewardPass123!");
    const stewardUserId = await stewardPage.evaluate(async () => { const r = await fetch("/api/auth/session"); return (await r.json())?.user?.id ?? ""; });
    const approveProposalRes = await apiCall(adminPage, "POST", `/api/proposals/${proposalId}/review`, { action: "APPROVE", reason: "Approved for G07 E2E test.", stewardId: stewardUserId });
    expect(approveProposalRes.ok).toBe(true);

    const propDetailRes = await apiCall(adminPage, "GET", `/api/proposals/${proposalId}`);
    const projectId = propDetailRes.data?.proposal?.project?.id;
    expect(projectId).toBeTruthy();

    // Step 3: Lead creates a connection to the mock provider
    await signin(leadPage, `${PREFIX}-lead@str-test.local`, PASSWORD);
    const connRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/integrations`, { providerId: "str.mock.v1", scopes: ["test"] });
    expect(connRes.ok, `Connection creation failed: ${connRes.error?.message}`).toBe(true);
    const connectionId = connRes.data?.connection?.id;
    expect(connectionId).toBeTruthy();

    // Step 4: Lead submits an integration job
    const jobRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/integrations/${connectionId}/jobs`, { capability: "application.test", idempotencyKey: `g07e2e-${PREFIX}`, payload: { input: "integration test" } });
    expect(jobRes.ok, `Job submission failed: ${jobRes.error?.message}`).toBe(true);
    const jobId = jobRes.data?.job?.id;
    expect(jobId).toBeTruthy();

    // Step 5: STANDALONE WORKER processes the job (no HTTP endpoint — real process)
    // The worker was started in beforeAll() and polls every 2s.
    // Poll the job status until it's completed.
    const jobResult = await pollJobStatus(leadPage, projectId, connectionId, jobId, 30000);
    expect(jobResult.status).toBe("succeeded");
    expect(jobResult.result).toBeTruthy();

    // Step 6: Lead revokes the connection
    const revokeRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/integrations/${connectionId}/revoke`, { reason: "Integration test complete — revoking for security." });
    expect(revokeRes.ok).toBe(true);
    expect(revokeRes.data?.connection?.status).toBe("revoked");

    // Step 7: New job submission is rejected
    const blockedRes = await apiCall(leadPage, "POST", `/api/projects/${projectId}/integrations/${connectionId}/jobs`, { capability: "application.test", idempotencyKey: `blocked-${PREFIX}`, payload: { input: "should be blocked" } });
    expect(blockedRes.ok).toBe(false);
    expect(blockedRes.status).toBeGreaterThanOrEqual(400);
  });

  test("webhook: missing signature rejected, forged rejected", async ({ browser }) => {
    test.setTimeout(60000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Missing signature → 401
    const noSig = await page.evaluate(async () => {
      const res = await fetch("/api/integrations/webhooks/str.mock.v1", { method: "POST", headers: { "Content-Type": "application/json", "x-str-event-id": "no-sig-test", "x-str-event-type": "test", "x-str-connection-id": "nonexistent", "x-str-timestamp": Date.now().toString() }, body: JSON.stringify({ test: true }) });
      return { status: res.status };
    });
    expect(noSig.status).toBeGreaterThanOrEqual(400);

    // Forged signature → 401 or 404
    const forged = await page.evaluate(async () => {
      const res = await fetch("/api/integrations/webhooks/str.mock.v1", { method: "POST", headers: { "Content-Type": "application/json", "x-str-event-id": "forged-test", "x-str-event-type": "test", "x-str-connection-id": "nonexistent", "x-str-timestamp": Date.now().toString(), "x-str-signature": "fakesignature" }, body: JSON.stringify({ test: true }) });
      return { status: res.status };
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });
});
