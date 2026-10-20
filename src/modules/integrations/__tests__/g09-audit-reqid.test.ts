/**
 * STR G09 Priority 2 — Gap 1: Request Correlation (reqId propagation)
 * -------------------------------------------------------------------
 * Verifies that AuditEvent.reqId is populated when an operation runs
 * inside a request context, and is null when it runs outside one
 * (e.g., background worker).
 *
 * Per MASTER directive: "تحقق من وصول request context فعلياً إلى طبقة
 * الخدمات" — this test confirms the propagation works end-to-end.
 */
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
  type TestRun,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import { approveProvider } from "@/modules/integrations/service";
import { runWithContext } from "@/lib/request-context";

let run: TestRun;
const uniqueProviderIds: string[] = [];

afterEach(async () => {
  if (run) {
    // Clean up unique providers created by this test run.
    for (const pid of uniqueProviderIds) {
      await db.integrationCapability.deleteMany({ where: { providerId: pid } }).catch(() => {});
      await db.integrationProvider.deleteMany({ where: { id: pid } }).catch(() => {});
    }
    uniqueProviderIds.length = 0;
    await cleanupTestRun(run);
  }
});

describe("G09-P2 Gap 1 — reqId propagation", () => {
  it("AuditEvent.reqId is populated when operation runs inside a request context", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    // Create a unique provider in "registered" state.
    const providerId = `str.mock.reqid-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: `str.mock.reqid-${run.runId}`,
        version: "v1",
        displayName: "reqId Test Provider",
        description: "Provider for reqId propagation test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // The TEST request id — a realistic format matching resolveRequestId.
    const testReqId = `req_test-${run.runId}-1234567890abcdef`;

    // Wrap the approveProvider call in a request context with our reqId.
    // This simulates what withRequestContext does in the API route handler.
    await runWithContext(
      { reqId: testReqId, startedAt: Date.now() },
      async () => {
        await approveProvider(providerId, adminId);
      },
    );

    // Verify the AuditEvent has our reqId.
    const audit = await db.auditEvent.findFirst({
      where: {
        actorId: adminId,
        action: "provider.approve",
        targetId: providerId,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    expect(audit?.reqId).toBe(testReqId);
    expect(audit?.outcome).toBe("success");
  });

  it("AuditEvent.reqId is null when operation runs WITHOUT a request context (worker scenario)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const providerId = `str.mock.no-reqid-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: `str.mock.no-reqid-${run.runId}`,
        version: "v1",
        displayName: "No-reqId Test Provider",
        description: "Provider for worker-scenario test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // Call approveProvider DIRECTLY, without wrapping in runWithContext.
    // This simulates a background worker calling the service.
    await approveProvider(providerId, adminId);

    const audit = await db.auditEvent.findFirst({
      where: {
        actorId: adminId,
        action: "provider.approve",
        targetId: providerId,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).toBeTruthy();
    // CRITICAL: reqId is null — no request context was active.
    expect(audit?.reqId).toBeNull();
    expect(audit?.outcome).toBe("success");
  });

  it("reqId propagation is per-request (does not leak across calls)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const provider1Id = `str.mock.leak-1-${run.runId}`;
    const provider2Id = `str.mock.leak-2-${run.runId}`;
    for (const pid of [provider1Id, provider2Id]) {
      await db.integrationProvider.create({
        data: {
          id: pid,
          slug: pid,
          version: "v1",
          displayName: `Leak Test ${pid}`,
          description: "Provider for leak test",
          owner: "STR Platform",
          baseOrigin: "https://mock.str.local",
          trustStatus: "registered",
          authMode: { type: "none" },
          isMock: true,
        },
      });
      uniqueProviderIds.push(pid);
    }

    // First approve with reqId-A
    await runWithContext(
      { reqId: "req_A-leak-test-aaaa", startedAt: Date.now() },
      async () => {
        await approveProvider(provider1Id, adminId);
      },
    );

    // Second approve WITHOUT any context (simulates worker)
    await approveProvider(provider2Id, adminId);

    // Verify: first audit has reqId-A, second audit has null reqId.
    // The contexts did NOT leak — AsyncLocalStorage isolates correctly.
    const audit1 = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: provider1Id },
    });
    const audit2 = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: provider2Id },
    });

    expect(audit1?.reqId).toBe("req_A-leak-test-aaaa");
    expect(audit2?.reqId).toBeNull();
  });

  it("withRequestContext HTTP helper reads the inbound header and propagates reqId", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const providerId = `str.mock.http-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "HTTP Helper Test Provider",
        description: "Provider for withRequestContext test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // Simulate what the API route does: read the header, wrap the handler.
    // We construct a minimal fake request-like object with headers.
    const inboundReqId = `req_inbound-${run.runId}-aaaaaaaaaaaaaaaa`;
    const fakeReq = {
      headers: new Headers({ "x-request-id": inboundReqId }),
    } as unknown as import("next/server").NextRequest;

    const { withRequestContext } = await import("@/lib/request-context-http");
    await withRequestContext(fakeReq, async () => {
      await approveProvider(providerId, adminId);
    });

    const audit = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: providerId },
    });
    expect(audit?.reqId).toBe(inboundReqId);
  });

  it("withRequestContext mints a fresh reqId when the inbound header is missing", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const providerId = `str.mock.mint-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Mint Test Provider",
        description: "Provider for header-missing test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // No x-request-id header provided.
    const fakeReq = { headers: new Headers() } as unknown as import("next/server").NextRequest;

    const { withRequestContext } = await import("@/lib/request-context-http");
    await withRequestContext(fakeReq, async () => {
      await approveProvider(providerId, adminId);
    });

    const audit = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: providerId },
    });
    // CRITICAL: reqId is NOT null (a fresh one was minted).
    expect(audit?.reqId).toBeTruthy();
    // It must start with "req_" (the resolveRequestId format).
    expect(audit?.reqId).toMatch(/^req_[a-f0-9-]{36}$/);
  });

  it("withRequestContext REJECTS a malformed inbound header (log injection prevention)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");

    const providerId = `str.mock.malformed-${run.runId}`;
    await db.integrationProvider.create({
      data: {
        id: providerId,
        slug: providerId,
        version: "v1",
        displayName: "Malformed Header Test",
        description: "Provider for header-injection test",
        owner: "STR Platform",
        baseOrigin: "https://mock.str.local",
        trustStatus: "registered",
        authMode: { type: "none" },
        isMock: true,
      },
    });
    uniqueProviderIds.push(providerId);

    // Malformed header — contains a newline (log-injection attempt).
    const maliciousHeader = "req_bad\nFAKE LOG LINE";
    const fakeReq = {
      headers: new Headers({ "x-request-id": maliciousHeader }),
    } as unknown as import("next/server").NextRequest;

    const { withRequestContext } = await import("@/lib/request-context-http");
    await withRequestContext(fakeReq, async () => {
      await approveProvider(providerId, adminId);
    });

    const audit = await db.auditEvent.findFirst({
      where: { action: "provider.approve", targetId: providerId },
    });
    // CRITICAL: the malicious header was NOT used. A fresh req_ id was minted.
    expect(audit?.reqId).toBeTruthy();
    expect(audit?.reqId).not.toBe(maliciousHeader);
    expect(audit?.reqId).not.toContain("\n");
    expect(audit?.reqId).toMatch(/^req_[a-f0-9-]{36}$/);
  });
});
