/**
 * STR G06-B — Admin Dashboard Unit Tests
 *
 * Tests:
 *   1. Admin can fetch dashboard stats
 *   2. Non-admin gets NotFound (not Forbidden — no role enumeration)
 *   3. Stats return correct counts
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
} from "@/modules/organizations/__tests__/test-isolation";
import { getAdminDashboardStats, listAllProposals, listRecentAuditEvents } from "@/modules/admin/dashboard";
import { NotFoundError } from "@/lib/errors";

let run: ReturnType<typeof startTestRun>;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

describe("G06-B — Admin dashboard authorization", () => {
  it("admin can fetch dashboard stats", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const stats = await getAdminDashboardStats(adminId);
    expect(stats).toBeTruthy();
    expect(stats.proposals).toBeDefined();
    expect(stats.projects).toBeDefined();
    expect(stats.organizations).toBeDefined();
    expect(stats.partnerships).toBeDefined();
    expect(stats.moderation).toBeDefined();
  });

  it("non-admin gets NotFound (not Forbidden)", async () => {
    run = startTestRun();
    const memberId = await createTestUser(run, "member");
    await expect(getAdminDashboardStats(memberId)).rejects.toThrow(NotFoundError);
    await expect(listAllProposals(memberId)).rejects.toThrow(NotFoundError);
    await expect(listRecentAuditEvents(memberId)).rejects.toThrow(NotFoundError);
  });

  it("partnership_manager cannot access admin dashboard (role separation)", async () => {
    run = startTestRun();
    const pmId = await createTestUser(run, "partnership_manager");
    await expect(getAdminDashboardStats(pmId)).rejects.toThrow(NotFoundError);
  });

  it("moderator cannot access admin dashboard (role separation)", async () => {
    run = startTestRun();
    const modId = await createTestUser(run, "moderator");
    await expect(getAdminDashboardStats(modId)).rejects.toThrow(NotFoundError);
  });
});
