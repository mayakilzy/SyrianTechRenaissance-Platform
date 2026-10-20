import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";
import { handleGoogleLink } from "@/modules/identity/service";
import { hashPassword } from "@/modules/identity/password";

/**
 * STR G09 — OAuth Collision Unit Tests (Priority 1.4)
 * ----------------------------------------------------
 * Tests handleGoogleLink safe-linking rules WITHOUT real Google credentials.
 *
 * Per MASTER G09 PHASE 3 directive §2 (OAuth Collision):
 *   - Test password-existing + Google email match → no auto-merge (blocked)
 *   - Test new Google identity → safe create+link per policy (created)
 *   - Test explicit link from authenticated user (linked)
 *   - Test providerAccountId conflict (blocked)
 *   - Test retry link + sync (linked)
 *   - Test account takeover via untrusted email (blocked — same as Rule 3)
 *
 * These are UNIT tests (not E2E) because handleGoogleLink is a service-layer
 * function — testing it directly is more deterministic than mocking OIDC.
 * E2E with real Google is deferred to G10 deployment readiness (requires
 * GOOGLE_CLIENT_ID/SECRET).
 *
 * Coverage classification for unified report:
 *   - 6 new unit tests that actually passed
 *   - 0 existing tests reused
 *   - 0 service/E2E without unit (these ARE the unit tests)
 *   - 0 incomplete/un-executable
 */

interface TestRun {
  runId: string;
  userIds: string[];
  authIdentityIds: string[];
}

function startTestRun(): TestRun {
  return { runId: randomBytes(4).toString("hex"), userIds: [], authIdentityIds: [] };
}

async function cleanupTestRun(run: TestRun): Promise<void> {
  // Delete auth identities first (no FK to user from auth identities that would block)
  if (run.authIdentityIds.length > 0) {
    await db.authIdentity.deleteMany({ where: { id: { in: run.authIdentityIds } } });
  }
  // Delete role grants + profiles + users
  if (run.userIds.length > 0) {
    await db.roleGrant.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.profileVisibility.deleteMany({
      where: { profile: { userId: { in: run.userIds } } },
    });
    await db.memberProfile.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.authIdentity.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.emailVerification.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.passwordReset.deleteMany({ where: { userId: { in: run.userIds } } });
    await db.user.deleteMany({ where: { id: { in: run.userIds } } });
  }
}

async function createPasswordUser(run: TestRun, email: string, displayName: string): Promise<string> {
  const passwordHash = await hashPassword("TestPassword123!");
  const user = await db.user.create({
    data: {
      email,
      displayName,
      status: "ACTIVE",
      emailVerified: new Date(),
      authIdentities: {
        create: {
          provider: "password",
          providerSub: email,
          emailAtLink: email,
          passwordHash,
        },
      },
      roleGrants: { create: { role: "member", scope: "global" } },
    },
  });
  run.userIds.push(user.id);
  return user.id;
}

let run: TestRun;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

describe("G09 — OAuth Collision (Priority 1.4)", () => {
  it("Rule 3: Google email matches existing password user → blocked (no auto-merge)", async () => {
    run = startTestRun();
    const email = `g09oauth3-${run.runId}@str-test.local`;
    await createPasswordUser(run, email, "Password User Rule 3");

    // Attempt Google sign-in with the same email
    const result = await handleGoogleLink({
      googleSub: `google-sub-3-${run.runId}`,
      googleEmail: email,
      googleName: "Google User",
      isExplicitLink: false,
    });

    expect(result.action).toBe("blocked");
    expect(result.userId).toBeUndefined();
    expect(result.message).toContain("already exists");

    // Verify NO new authIdentity was created for the password user (no auto-merge)
    const identities = await db.authIdentity.findMany({
      where: { userId: run.userIds[0] },
    });
    expect(identities.length).toBe(1); // only the password identity
    expect(identities[0]!.provider).toBe("password");
  });

  it("Rule 4: New Google email (no existing user) → created (safe new account)", async () => {
    run = startTestRun();
    const googleEmail = `g09oauth4-${run.runId}@str-test.local`;
    const googleSub = `google-sub-4-${run.runId}`;

    const result = await handleGoogleLink({
      googleSub,
      googleEmail,
      googleName: "New Google User",
      isExplicitLink: false,
    });

    expect(result.action).toBe("created");
    expect(result.userId).toBeTruthy();

    // Track for cleanup
    run.userIds.push(result.userId!);

    // Verify new user created with Google auth identity
    const newUser = await db.user.findUnique({
      where: { id: result.userId },
      include: { authIdentities: true },
    });
    expect(newUser).toBeTruthy();
    expect(newUser!.email).toBe(googleEmail);
    expect(newUser!.status).toBe("ACTIVE");
    expect(newUser!.emailVerified).toBeTruthy(); // Google verified the email
    const googleIdentity = newUser!.authIdentities.find((i) => i.provider === "google");
    expect(googleIdentity).toBeTruthy();
    expect(googleIdentity!.providerSub).toBe(googleSub);
  });

  it("Rule 1: Explicit link from authenticated user → linked", async () => {
    run = startTestRun();
    const email = `g09oauth1-${run.runId}@str-test.local`;
    const userId = await createPasswordUser(run, email, "Password User Rule 1");
    const googleSub = `google-sub-1-${run.runId}`;

    // User is logged in (existingUserId provided) + explicitly linking Google
    const result = await handleGoogleLink({
      googleSub,
      googleEmail: email, // same email is OK for explicit link (user proved ownership via password login)
      isExplicitLink: true,
      existingUserId: userId,
    });

    expect(result.action).toBe("linked");
    expect(result.userId).toBe(userId);

    // Verify Google auth identity was created for the existing user
    const identities = await db.authIdentity.findMany({
      where: { userId, provider: "google" },
    });
    expect(identities.length).toBe(1);
    expect(identities[0]!.providerSub).toBe(googleSub);
  });

  it("Rule 1 conflict: Google sub already linked to DIFFERENT user → blocked", async () => {
    run = startTestRun();
    const emailA = `g09oauth-conf-a-${run.runId}@str-test.local`;
    const emailB = `g09oauth-conf-b-${run.runId}@str-test.local`;
    const userIdA = await createPasswordUser(run, emailA, "User A");
    const userIdB = await createPasswordUser(run, emailB, "User B");
    const googleSub = `google-sub-conf-${run.runId}`;

    // First, user A explicitly links Google sub
    const firstLink = await handleGoogleLink({
      googleSub,
      googleEmail: emailA,
      isExplicitLink: true,
      existingUserId: userIdA,
    });
    expect(firstLink.action).toBe("linked");

    // Now user B tries to link the SAME Google sub → should be blocked
    const secondLink = await handleGoogleLink({
      googleSub,
      googleEmail: emailB,
      isExplicitLink: true,
      existingUserId: userIdB,
    });
    expect(secondLink.action).toBe("blocked");
    expect(secondLink.message).toContain("already linked");

    // Verify no Google identity was created for user B
    const identitiesB = await db.authIdentity.findMany({
      where: { userId: userIdB, provider: "google" },
    });
    expect(identitiesB.length).toBe(0);
  });

  it("Rule 2: Existing Google sub → linked (sign in with Google)", async () => {
    run = startTestRun();
    const googleEmail = `g09oauth2-${run.runId}@str-test.local`;
    const googleSub = `google-sub-2-${run.runId}`;

    // First sign-in creates the user
    const firstResult = await handleGoogleLink({
      googleSub,
      googleEmail,
      googleName: "Google User Rule 2",
      isExplicitLink: false,
    });
    expect(firstResult.action).toBe("created");
    run.userIds.push(firstResult.userId!);

    // Second sign-in with same Google sub → linked (sign in, not create)
    const secondResult = await handleGoogleLink({
      googleSub,
      googleEmail,
      googleName: "Google User Rule 2",
      isExplicitLink: false,
    });
    expect(secondResult.action).toBe("linked");
    expect(secondResult.userId).toBe(firstResult.userId);
  });

  it("Account takeover attempt: Google email matches existing password user (untrusted) → blocked", async () => {
    run = startTestRun();
    const victimEmail = `g09oauth-victim-${run.runId}@str-test.local`;
    await createPasswordUser(run, victimEmail, "Victim User");

    // Attacker controls a Google account with the SAME email as the victim's password account
    // (e.g., victim has password@str-test.local; attacker has a Google account with same email)
    // Attacker attempts Google sign-in → must be BLOCKED (no auto-merge)
    const result = await handleGoogleLink({
      googleSub: `attacker-google-sub-${run.runId}`,
      googleEmail: victimEmail, // same email as victim's password account
      googleName: "Attacker",
      isExplicitLink: false,
    });

    expect(result.action).toBe("blocked");
    expect(result.userId).toBeUndefined();

    // Verify victim's account was NOT taken over (no Google identity added)
    const victimIdentities = await db.authIdentity.findMany({
      where: { userId: run.userIds[0] },
    });
    expect(victimIdentities.length).toBe(1);
    expect(victimIdentities[0]!.provider).toBe("password");
  });
});
