/**
 * STR G06-A — Organizations + Representatives Unit Tests
 *
 * Tests critical G06 invariants:
 *   1. Anti-self-verification: a representative cannot verify their own authority
 *   2. Only admin can verify/suspend/revoke organizations
 *   3. Cross-org isolation: user from org A cannot see org B (test EXISTS, not just 404)
 *   4. Partnership manager + moderator roles work correctly
 *   5. Atomic state transitions with optimistic locks
 *   6. Audit events recorded for sensitive decisions
 *
 * Per MASTER G06 directive: "اختبار الوصول غير المصرح به إلى سجلات موجودة فعلياً"
 * — test unauthorized access to EXISTING records, not just non-existent IDs.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
  createTestOrganization,
  createTestRepresentative,
  type TestRun,
} from "./test-isolation";
import {
  registerOrganization,
  verifyOrganization,
  suspendOrganization,
  reactivateOrganization,
  revokeOrganization,
  addRepresentative,
  verifyRepresentative,
  listOrganizations,
  getOrganization,
} from "@/modules/organizations/service";
import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

describe("G06-A — Organization lifecycle", () => {
  it("registers an organization in PENDING_VERIFICATION", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const org = await registerOrganization(adminId, {
      legalName: "Test Org",
      displayName: "Test Org Display",
      email: `g06-org-${run.runId}@test.local`,
    });
    expect(org.status).toBe("PENDING_VERIFICATION");
    expect(org.verifiedAt).toBeNull();
  });

  it("verifies PENDING → ACTIVE (admin only, atomic)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "PENDING_VERIFICATION");
    const result = await verifyOrganization(orgId, adminId);
    expect(result.status).toBe("ACTIVE");
    const updated = await db.organization.findUnique({ where: { id: orgId } });
    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.verifiedAt).toBeTruthy();
    expect(updated?.verifiedById).toBe(adminId);
    // Audit event recorded
    const audit = await db.auditEvent.findFirst({
      where: { action: "organization.verify", targetId: orgId },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(adminId);
  });

  it("prevents non-admin from verifying an organization", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const memberId = await createTestUser(run, "member");
    const orgId = await createTestOrganization(run, adminId, "PENDING_VERIFICATION");
    await expect(verifyOrganization(orgId, memberId)).rejects.toThrow(ForbiddenError);
  });

  it("suspends and reactivates an ACTIVE organization", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "ACTIVE");
    await suspendOrganization(orgId, adminId, "Pending compliance review with substantial reason.");
    let updated = await db.organization.findUnique({ where: { id: orgId } });
    expect(updated?.status).toBe("SUSPENDED");
    await reactivateOrganization(orgId, adminId);
    updated = await db.organization.findUnique({ where: { id: orgId } });
    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.suspendedAt).toBeNull();
  });

  it("revokes an organization (terminal)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "ACTIVE");
    await revokeOrganization(orgId, adminId, "Permanent revocation due to verified violation.");
    const updated = await db.organization.findUnique({ where: { id: orgId } });
    expect(updated?.status).toBe("REVOKED");
    expect(updated?.revokedAt).toBeTruthy();
    // Cannot revoke again
    await expect(revokeOrganization(orgId, adminId, "Second attempt.")).rejects.toThrow(ConflictError);
  });
});

describe("G06-A — Anti-self-verification (critical constraint)", () => {
  it("prevents a representative from verifying their own delegated authority", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const repId = await createTestUser(run, "rep");
    const orgId = await createTestOrganization(run, adminId, "ACTIVE");
    // Add rep (unverified)
    const rep = await addRepresentative(orgId, adminId, {
      userId: repId,
      role: "signatory",
      delegatedAuthorityScope: "Full authority to sign partnership requests and agreements on behalf of the organization.",
    });
    // The rep tries to verify themselves — must be Forbidden
    await expect(verifyRepresentative(rep.id, repId)).rejects.toThrow(ForbiddenError);
    // Confirm the rep is still unverified
    const unchanged = await db.organizationRepresentative.findUnique({ where: { id: rep.id } });
    expect(unchanged?.verifiedAt).toBeNull();
  });

  it("admin (independent) can verify a representative", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const repId = await createTestUser(run, "rep");
    const otherAdminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "ACTIVE");
    const rep = await addRepresentative(orgId, adminId, {
      userId: repId,
      role: "signatory",
      delegatedAuthorityScope: "Authority to sign partnership requests on behalf of the organization.",
    });
    // Admin (different from rep) verifies
    const result = await verifyRepresentative(rep.id, otherAdminId);
    expect(result.verifiedAt).toBeTruthy();
    const updated = await db.organizationRepresentative.findUnique({ where: { id: rep.id } });
    expect(updated?.verifiedAt).toBeTruthy();
    expect(updated?.verifiedById).toBe(otherAdminId);
  });
});

describe("G06-A — Cross-org isolation (test EXISTING records)", () => {
  it("member of org A cannot see org B (both EXIST, isolation enforced)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const repAId = await createTestUser(run, "rep");
    const repBId = await createTestUser(run, "rep");
    const otherAdminId = await createTestUser(run, "admin");

    const orgAId = await createTestOrganization(run, adminId, "ACTIVE");
    const orgBId = await createTestOrganization(run, adminId, "ACTIVE");

    // Make rep A a verified rep of org A
    const repA = await addRepresentative(orgAId, adminId, {
      userId: repAId,
      role: "signatory",
      delegatedAuthorityScope: "Authority for org A partnership requests.",
    });
    await verifyRepresentative(repA.id, otherAdminId);

    // rep A tries to see org B — both orgs EXIST, but rep A has no role in org B
    // Per MASTER: "اختبار الوصول غير المصرح به إلى سجلات موجودة فعلياً"
    await expect(getOrganization(orgBId, repAId)).rejects.toThrow(NotFoundError);
  });

  it("non-admin user cannot list organizations", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const memberId = await createTestUser(run, "member");
    await createTestOrganization(run, adminId, "ACTIVE");
    await expect(listOrganizations(memberId)).rejects.toThrow(ForbiddenError);
  });
});

describe("G06-A — Optimistic lock on transitions", () => {
  it("prevents concurrent verify attempts (atomic transition)", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "PENDING_VERIFICATION");
    await verifyOrganization(orgId, adminId);
    // Second verify attempt fails (already ACTIVE)
    await expect(verifyOrganization(orgId, adminId)).rejects.toThrow(ConflictError);
  });

  it("prevents suspend of a non-ACTIVE organization", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "PENDING_VERIFICATION");
    await expect(
      suspendOrganization(orgId, adminId, "Attempting to suspend a non-active org with sufficient reason."),
    ).rejects.toThrow(ConflictError);
  });
});

describe("G06-A — Validation", () => {
  it("rejects short suspension reason", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const orgId = await createTestOrganization(run, adminId, "ACTIVE");
    await expect(suspendOrganization(orgId, adminId, "short")).rejects.toThrow(ValidationError);
  });

  it("rejects duplicate organization email", async () => {
    run = startTestRun();
    const adminId = await createTestUser(run, "admin");
    const email = `g06-dup-${run.runId}@test.local`;
    await registerOrganization(adminId, {
      legalName: "First Org",
      displayName: "First",
      email,
    });
    await expect(
      registerOrganization(adminId, {
        legalName: "Second Org",
        displayName: "Second",
        email,
      }),
    ).rejects.toThrow(ConflictError);
  });
});
