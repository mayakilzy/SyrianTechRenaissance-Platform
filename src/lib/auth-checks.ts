/**
 * STR G11-00A — Shared active-user check helper.
 * ------------------------------------------------
 * Centralizes the "is this user ACTIVE?" check that was duplicated
 * (and often missing) across modules. The pattern is:
 *
 *   1. Fetch the user by ID, selecting only `id` and `status`.
 *   2. Return false / throw if the user doesn't exist or status !== "ACTIVE".
 *
 * This is defense-in-depth on top of any HTTP-layer auth check. It exists
 * because NextAuth session cookies persist until cookie expiry, even after
 * the user is suspended. Without this service-layer check, a SUSPENDED
 * user with a still-valid session cookie could pass role-grant checks
 * (which only look at `roleGrant.revokedAt: null`).
 *
 * Usage:
 *   import { assertActiveUser, isActiveUser } from "@/lib/auth-checks";
 *
 *   // Throw if not active:
 *   await assertActiveUser(userId);
 *
 *   // Boolean check (for use inside role-check helpers):
 *   if (!(await isActiveUser(userId))) return false;
 *
 * G11-00A: applied to teams, projects, organizations, moderation, admin,
 * and integrations modules. Closes FOLLOW-UP-1 from the G11-00 defect
 * register.
 */

import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";

/**
 * Returns true if the user exists and status === "ACTIVE".
 * Returns false otherwise (including if the user doesn't exist).
 *
 * Use this inside role-check helpers that already return a boolean.
 */
export async function isActiveUser(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });
  return !!user && user.status === "ACTIVE";
}

/**
 * Throws ForbiddenError if the user does not exist or status !== "ACTIVE".
 *
 * Use this at the top of privileged service operations to fail-closed
 * before any other check.
 */
export async function assertActiveUser(userId: string): Promise<void> {
  if (!(await isActiveUser(userId))) {
    throw new ForbiddenError("Account is not active; operation denied");
  }
}
