/**
 * STR G11-00A — HTTP-Level Suspended-User Integration Test
 * ---------------------------------------------------------
 * Per MASTER's review of G11-00:
 *   "اختبارات الحساب الموقوف الجديدة تعمل على مستوى الخدمات مباشرة.
 *    لم يُضف اختبار HTTP يثبت منع مستخدم موقوف يحمل جلسة صالحة من
 *    تنفيذ العملية عبر التطبيق الفعلي."
 *
 * This test:
 *   1. Authenticates an ACTIVE user (simulates a valid session cookie).
 *   2. Verifies the user CAN create a proposal (positive control).
 *   3. Suspends the user (simulates admin action mid-session).
 *   4. Re-attempts the same operation using the SAME valid session.
 *   5. Verifies the operation is DENIED (HTTP 403) AND no DB row was created.
 *
 * The session is simulated by calling the API route handler directly with
 * a mocked `getServerSession` return value. This is appropriate because:
 *   - The route handler is the actual production code path.
 *   - Mocking `getServerSession` simulates "session cookie still valid"
 *     without needing to spin up a full Next.js dev server.
 *   - The DB write actually hits the real PostgreSQL, so the "no DB row
 *     was created" assertion is meaningful.
 *
 * G11-00A: addresses point #2 from MASTER's review of G11-00.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";

interface TestRun {
  runId: string;
  userIds: string[];
}

function startTestRun(): TestRun {
  return { runId: randomBytes(4).toString("hex"), userIds: [] };
}

async function createActiveUser(run: TestRun): Promise<{ id: string; email: string }> {
  const user = await db.user.create({
    data: {
      email: `g11a-http-${run.runId}-${randomBytes(2).toString("hex")}@str-test.local`,
      displayName: `G11A HTTP Test`,
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: [{ role: "member", scope: "global" }] },
    },
  });
  run.userIds.push(user.id);
  return { id: user.id, email: user.email };
}

async function cleanupTestRun(run: TestRun): Promise<void> {
  if (run.userIds.length === 0) return;
  const proposals = await db.projectProposal.findMany({
    where: { submitterId: { in: run.userIds } },
    select: { id: true },
  });
  const proposalIds = proposals.map((p) => p.id);
  await db.reviewDecision.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.project.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.charterRevision.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.projectProposal.deleteMany({ where: { id: { in: proposalIds } } });
  await db.roleGrant.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.emailVerification.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.passwordReset.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.user.deleteMany({ where: { id: { in: run.userIds } } });
}

const validCharter = {
  problemStatement: "G11-00A HTTP-level test for suspended-user enforcement.",
  outcomes: "Verify that a suspended user with a valid session cannot create proposals via HTTP.",
  scope: "Engineering validation only — no UI changes.",
  requiredSkills: ["TypeScript", "PostgreSQL", "Security"],
  acceptanceCriteria: "HTTP returns 403 and no proposal is created.",
};

let run: TestRun;

beforeEach(() => {
  // Mock next-auth's getServerSession to return our test user's session.
  // This simulates a valid session cookie without spinning up a Next.js dev server.
  vi.mock("next-auth", () => ({
    getServerSession: vi.fn(),
  }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (run) await cleanupTestRun(run);
});

describe("G11-00A — HTTP-level: suspended user with valid session cannot create proposals", () => {
  it("ACTIVE user can create a proposal via POST /api/proposals (positive control)", async () => {
    run = startTestRun();
    const user = await createActiveUser(run);

    const { getServerSession } = await import("next-auth");
    const { getAuthOptions } = await import("@/modules/identity/auth-config");
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: user.id, email: user.email, name: "Test User", image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as never);

    const { POST } = await import("@/app/api/proposals/route");
    const req = new Request("http://localhost/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "HTTP Positive Control Title", charter: validCharter }),
    });
    const response = await POST(req as never);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.proposal.status).toBe("DRAFT");

    // Verify the proposal exists in the DB.
    const dbProposal = await db.projectProposal.findUnique({ where: { id: body.data.proposal.id } });
    expect(dbProposal).not.toBeNull();
    expect(dbProposal?.submitterId).toBe(user.id);
  });

  it("SUSPENDED user (with still-valid session) CANNOT create a proposal — HTTP 403 + no DB row", async () => {
    run = startTestRun();
    const user = await createActiveUser(run);

    // Suspend the user (simulates admin action mid-session).
    await db.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });

    // The session cookie is STILL VALID (we mock getServerSession to return the same session).
    const { getServerSession } = await import("next-auth");
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: user.id, email: user.email, name: "Test User", image: null },
      expires: new Date(Date.now() + 86400000).toISOString(), // 24h from now — still valid
    } as never);

    const { POST } = await import("@/app/api/proposals/route");
    const req = new Request("http://localhost/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Should Fail Title", charter: validCharter }),
    });
    const response = await POST(req as never);

    // EXPECT: 403 Forbidden (not 201 Created, not 500 Internal Error).
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("STR_FORBIDDEN");

    // CRITICAL: verify no proposal was created in the DB.
    const proposals = await db.projectProposal.findMany({
      where: { submitterId: user.id },
    });
    expect(proposals.length).toBe(0);
  });
});
