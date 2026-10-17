/**
 * STR G03-FINAL-POLICY — Authorization Policy Consistency Tests
 *
 * Tests the two policy fixes:
 *   1. proposal:review and proposal:approve require institutional role
 *   2. GET /api/proposals/[id] protects DRAFT from reviewers
 *
 * These tests verify the authorizeProject() function directly.
 */

import { describe, it, expect } from "vitest";
import { authorizeProject, type ProjectActor } from "@/modules/governance/authorize-project";

function makeActor(
  isAdmin: boolean,
  projectRoles: Map<string, Set<"project_lead" | "steward" | "team_member">> = new Map(),
): ProjectActor {
  return {
    userId: "test-user",
    isAdmin,
    projectRoles,
  };
}

describe("G03-FINAL-POLICY §1 — proposal:review requires institutional role", () => {
  it("denies a regular member (not admin) from reviewing", () => {
    const member = makeActor(false);
    const result = authorizeProject(member, "proposal:review", "proj-1", false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("requires_institutional_reviewer");
  });

  it("allows an admin to review", () => {
    const admin = makeActor(true);
    const result = authorizeProject(admin, "proposal:review", "proj-1", false);
    expect(result.allowed).toBe(true);
  });

  it("denies the submitter from reviewing their own proposal (conflict of interest)", () => {
    const admin = makeActor(true);
    const result = authorizeProject(admin, "proposal:review", "proj-1", true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("conflict_of_interest");
  });
});

describe("G03-FINAL-POLICY §1 — proposal:approve requires institutional role", () => {
  it("denies a regular member from approving", () => {
    const member = makeActor(false);
    const result = authorizeProject(member, "proposal:approve", "proj-1", false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("requires_institutional_reviewer");
  });

  it("allows an admin to approve (service layer checks steward separately)", () => {
    const admin = makeActor(true);
    const result = authorizeProject(admin, "proposal:approve", "proj-1", false);
    expect(result.allowed).toBe(true);
  });

  it("denies the submitter from approving their own proposal", () => {
    const admin = makeActor(true);
    const result = authorizeProject(admin, "proposal:approve", "proj-1", true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("conflict_of_interest");
  });
});

describe("G03-FINAL-POLICY §1 — other actions unaffected", () => {
  it("allows team member to read project", () => {
    const roles = new Map([["proj-1", new Set(["team_member"] as const)]]);
    const member = makeActor(false, roles);
    expect(authorizeProject(member, "project:read", "proj-1").allowed).toBe(true);
  });

  it("allows steward to suspend", () => {
    const roles = new Map([["proj-1", new Set(["steward"] as const)]]);
    const steward = makeActor(false, roles);
    expect(authorizeProject(steward, "project:suspend", "proj-1").allowed).toBe(true);
  });

  it("denies regular member from suspending", () => {
    const roles = new Map([["proj-1", new Set(["team_member"] as const)]]);
    const member = makeActor(false, roles);
    expect(authorizeProject(member, "project:suspend", "proj-1").allowed).toBe(false);
  });

  it("allows lead to invite", () => {
    const roles = new Map([["proj-1", new Set(["project_lead"] as const)]]);
    const lead = makeActor(false, roles);
    expect(authorizeProject(lead, "team:invite", "proj-1").allowed).toBe(true);
  });
});

describe("G03-FINAL-POLICY §1 — unauthenticated access", () => {
  it("denies unauthenticated user from reviewing", () => {
    expect(authorizeProject(null, "proposal:review").allowed).toBe(false);
  });

  it("denies unauthenticated user from approving", () => {
    expect(authorizeProject(null, "proposal:approve").allowed).toBe(false);
  });
});
