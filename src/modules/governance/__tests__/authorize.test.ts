import { describe, it, expect } from "vitest";
import { authorize, type Actor } from "@/modules/governance/authorize";

describe("Authorization service", () => {
  const member: Actor = { userId: "user-1", role: "member" };
  const admin: Actor = { userId: "admin-1", role: "admin" };
  const ownProfile = { kind: "profile" as const, id: "p1", ownerId: "user-1" };
  const otherProfile = { kind: "profile" as const, id: "p2", ownerId: "user-2" };

  // ── STR-GOV-TEAM-01: team creation ALWAYS denied ──
  it("denies team creation for members (STR-GOV-TEAM-01)", () => {
    const result = authorize(member, "team:create");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("STR-GOV-TEAM-01");
  });

  it("denies team creation even for admins (STR-GOV-TEAM-01)", () => {
    const result = authorize(admin, "team:create");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("STR-GOV-TEAM-01");
  });

  // ── Profile ownership ──
  it("allows member to read own profile", () => {
    expect(authorize(member, "profile:read:own", ownProfile).allowed).toBe(true);
  });

  it("denies member from reading another user's private profile data", () => {
    expect(authorize(member, "profile:read:own", otherProfile).allowed).toBe(false);
  });

  it("allows member to update own profile", () => {
    expect(authorize(member, "profile:update:own", ownProfile).allowed).toBe(true);
  });

  it("denies member from updating another user's profile", () => {
    expect(authorize(member, "profile:update:own", otherProfile).allowed).toBe(false);
  });

  it("allows member to delete own profile", () => {
    expect(authorize(member, "profile:delete:own", ownProfile).allowed).toBe(true);
  });

  // ── Public reads ──
  it("allows public profile reads without authentication", () => {
    expect(authorize(null, "profile:read:public").allowed).toBe(true);
  });

  // ── Admin powers ──
  it("denies member from reading any profile (admin-only)", () => {
    expect(authorize(member, "profile:read:any").allowed).toBe(false);
  });

  it("allows admin to read any profile", () => {
    expect(authorize(admin, "profile:read:any").allowed).toBe(true);
  });

  it("allows admin to suspend users", () => {
    expect(authorize(admin, "user:suspend").allowed).toBe(true);
  });

  it("denies member from suspending users", () => {
    expect(authorize(member, "user:suspend").allowed).toBe(false);
  });

  // ── Fail-closed ──
  it("denies unauthenticated requests to protected actions", () => {
    const result = authorize(null, "profile:update:own", ownProfile);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_authenticated");
  });

  it("denies unknown actions (fail-closed)", () => {
    // @ts-expect-error testing unknown action
    const result = authorize(member, "unknown:action");
    expect(result.allowed).toBe(false);
  });

  // ── Project creation deferred to G03 ──
  it("denies project creation in G02 (arrives in G03)", () => {
    const result = authorize(admin, "project:create");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("G03");
  });
});
