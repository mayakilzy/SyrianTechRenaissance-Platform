/**
 * STR Governance — Authorization Service
 * --------------------------------------
 * Central `authorize(actor, action, resource)` function. Fail-closed by
 * default: if the actor's permissions cannot be determined, access is DENIED.
 *
 * RBAC + resource-scoped checks (ABAC) per 02-Architecture §4.
 *
 * G02 scope: global roles (member, admin) + ownership checks.
 * G03+ scope: project-scoped roles (project_lead, steward, team_member).
 *
 * See 03-Data-and-Permissions §"Sample policy matrix" and §"Negative testing".
 */

import { db } from "@/lib/db";

export type Role = "member" | "admin";

export type Action =
  | "profile:read:own"
  | "profile:read:public"
  | "profile:update:own"
  | "profile:delete:own"
  | "profile:read:any" // admin
  | "profile:update:any" // admin
  | "user:read:list" // admin
  | "user:suspend" // admin
  | "team:create" // ALWAYS denied in G02 (STR-GOV-TEAM-01)
  | "project:create"; // not in G02 scope

export interface Actor {
  userId: string;
  role: Role;
}

export interface Resource {
  kind: "profile" | "user";
  id: string;
  ownerId?: string;
}

export interface AuthzResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether an actor may perform an action on a resource.
 * Fail-closed: returns `allowed: false` for any unrecognized combination.
 */
export function authorize(
  actor: Actor | null,
  action: Action,
  resource?: Resource,
): AuthzResult {
  // No actor = no access (except public reads, handled separately).
  if (!actor) {
    if (action === "profile:read:public") {
      return { allowed: true, reason: "public_read" };
    }
    return { allowed: false, reason: "not_authenticated" };
  }

  // STR-GOV-TEAM-01: team creation is ALWAYS denied in G02.
  // No member or admin can create a team without an approved project charter.
  // This is enforced here, not just in the UI.
  if (action === "team:create") {
    return {
      allowed: false,
      reason: "STR-GOV-TEAM-01: teams require an approved project charter",
    };
  }

  // G02 scope guard: project creation is not available yet.
  if (action === "project:create") {
    return {
      allowed: false,
      reason: "project creation arrives in G03",
    };
  }

  switch (action) {
    // ── Profile: own ──
    case "profile:read:own":
      if (resource && resource.ownerId !== actor.userId) {
        return { allowed: false, reason: "not_owner" };
      }
      return { allowed: true };

    case "profile:update:own":
      if (resource && resource.ownerId !== actor.userId) {
        return { allowed: false, reason: "not_owner" };
      }
      return { allowed: true };

    case "profile:delete:own":
      if (resource && resource.ownerId !== actor.userId) {
        return { allowed: false, reason: "not_owner" };
      }
      return { allowed: true };

    // ── Profile: public ──
    case "profile:read:public":
      return { allowed: true, reason: "public_read" };

    // ── Admin-only ──
    case "profile:read:any":
    case "profile:update:any":
    case "user:read:list":
    case "user:suspend":
      if (actor.role !== "admin") {
        return { allowed: false, reason: "requires_admin" };
      }
      return { allowed: true };

    default:
      // Fail-closed for any unrecognized action.
      return { allowed: false, reason: "unknown_action" };
  }
}

/**
 * Load an actor from the database by user ID.
 * Returns null if the user doesn't exist or has no active role grant.
 */
export async function loadActor(userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roleGrants: {
        where: { revokedAt: null },
        orderBy: { grantedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!user || user.status !== "ACTIVE") return null;

  const role = user.roleGrants[0]?.role;
  if (!role) return null;

  return {
    userId: user.id,
    role: role as Role,
  };
}

/**
 * Check if a user can perform an action on a resource, loading the actor
 * from the database. Convenience wrapper for API routes.
 */
export async function can(
  userId: string | null,
  action: Action,
  resource?: Resource,
): Promise<AuthzResult> {
  if (!userId) return authorize(null, action, resource);
  const actor = await loadActor(userId);
  return authorize(actor, action, resource);
}

/**
 * Guard: throw ForbiddenError if the actor cannot perform the action.
 * Used in API routes to enforce authorization before processing.
 */
export async function guard(
  userId: string | null,
  action: Action,
  resource?: Resource,
): Promise<Actor> {
  const result = await can(userId, action, resource);
  if (!result.allowed) {
    const { ForbiddenError } = await import("@/lib/errors");
    throw new ForbiddenError(result.reason ?? "access denied");
  }
  // We know actor is non-null because can() returned allowed for a non-null userId.
  // For public reads with null userId, we don't reach here (caller handles).
  const actor = await loadActor(userId!);
  if (!actor) {
    const { ForbiddenError } = await import("@/lib/errors");
    throw new ForbiddenError("actor not found");
  }
  return actor;
}
