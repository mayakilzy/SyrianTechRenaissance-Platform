/**
 * STR Governance — Project-Scoped Authorization (G03 extension)
 * -------------------------------------------------------------
 * Extends the G02 authorize() with project-scoped roles:
 *   - project_lead   (leads a specific project)
 *   - steward        (institutional oversight for a specific project)
 *   - team_member    (member of a specific project's team)
 *
 * These are NOT global roles — they apply to a specific project/team.
 * The actor's project-scoped roles are loaded from TeamMembership +
 * StewardAssignment.
 *
 * See 02-Architecture §4 and 03-Data-and-Permissions §"Sample policy matrix".
 */

import { db } from "@/lib/db";

export type ProjectAction =
  | "proposal:read"
  | "proposal:review"        // reviewer (not submitter)
  | "proposal:approve"       // reviewer with steward assignment
  | "project:read"
  | "project:suspend"        // steward or admin
  | "project:reactivate"     // steward or admin
  | "team:read"
  | "team:invite"            // lead or steward
  | "team:leave"
  | "resource:grant"         // steward or admin
  | "resource:revoke";       // steward or admin

export interface ProjectActor {
  userId: string;
  isAdmin: boolean;
  isReviewer: boolean;
  projectRoles: Map<string, Set<"project_lead" | "steward" | "team_member">>;
}

/**
 * Load an actor's project-scoped roles from the database.
 * Returns a ProjectActor with a map of projectId → set of roles.
 */
export async function loadProjectActor(userId: string): Promise<ProjectActor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roleGrants: { where: { revokedAt: null } },
      teamMemberships: {
        where: { leftAt: null },
        include: { team: { select: { projectId: true } } },
      },
      stewardAssignments: { where: { unassignedAt: null } },
    },
  });

  if (!user || user.status !== "ACTIVE") return null;

  // Determine global role: check for admin first, then reviewer, then member.
  // Don't rely on the first RoleGrant record — the order is not guaranteed.
  const hasAdmin = user.roleGrants.some((g) => g.role === "admin");
  const hasReviewer = user.roleGrants.some((g) => g.role === "reviewer");
  const isAdmin = hasAdmin;
  const isReviewer = hasReviewer;

  const projectRoles = new Map<string, Set<"project_lead" | "steward" | "team_member">>();

  // Add team membership roles.
  for (const membership of user.teamMemberships) {
    const projectId = membership.team.projectId;
    if (!projectRoles.has(projectId)) projectRoles.set(projectId, new Set());
    const roleLower = membership.role.toLowerCase();
    if (roleLower === "lead") {
      projectRoles.get(projectId)!.add("project_lead");
    } else if (roleLower === "steward") {
      projectRoles.get(projectId)!.add("steward");
    } else {
      projectRoles.get(projectId)!.add("team_member");
    }
  }

  // Add steward assignments.
  for (const assignment of user.stewardAssignments) {
    if (!projectRoles.has(assignment.projectId)) projectRoles.set(assignment.projectId, new Set());
    projectRoles.get(assignment.projectId)!.add("steward");
  }

  return { userId, isAdmin, isReviewer, projectRoles };
}

/**
 * Check if an actor can perform a project-scoped action.
 * Returns { allowed: boolean, reason?: string }.
 */
export function authorizeProject(
  actor: ProjectActor | null,
  action: ProjectAction,
  projectId?: string,
  isSubmitter = false,
): { allowed: boolean; reason?: string } {
  if (!actor) {
    return { allowed: false, reason: "not_authenticated" };
  }

  // Admin can do everything EXCEPT review/approve their own proposals
  // (conflict of interest applies even to admins).
  if (actor.isAdmin && action !== "proposal:review" && action !== "proposal:approve") {
    return { allowed: true };
  }

  const roles = projectId ? (actor.projectRoles.get(projectId) ?? new Set()) : new Set();

  switch (action) {
    case "proposal:read":
      // Anyone can read proposals (public review queue). Specific proposal
      // visibility (draft vs submitted) is handled by the service layer.
      return { allowed: true };

    case "proposal:review":
      // Only institutional reviewers (admin or reviewer role) can review.
      if (isSubmitter) {
        return { allowed: false, reason: "conflict_of_interest" };
      }
      if (!actor.isAdmin && !actor.isReviewer) {
        return { allowed: false, reason: "requires_institutional_reviewer" };
      }
      return { allowed: true };

    case "proposal:approve":
      // Only institutional reviewers can approve. The steward assignment
      // is verified in the service layer (reviewProposal).
      if (isSubmitter) {
        return { allowed: false, reason: "conflict_of_interest" };
      }
      if (!actor.isAdmin && !actor.isReviewer) {
        return { allowed: false, reason: "requires_institutional_reviewer" };
      }
      return { allowed: true };

    case "project:read":
    case "team:read":
      // Team members, steward, and lead can read. Also public projects can be
      // read by anyone (future). For now, require some project role.
      if (roles.size > 0) return { allowed: true };
      return { allowed: false, reason: "not_team_member" };

    case "project:suspend":
    case "project:reactivate":
    case "resource:grant":
    case "resource:revoke":
      // Steward only.
      if (roles.has("steward")) return { allowed: true };
      return { allowed: false, reason: "requires_steward" };

    case "team:invite":
      // Lead or steward.
      if (roles.has("project_lead") || roles.has("steward")) return { allowed: true };
      return { allowed: false, reason: "requires_lead_or_steward" };

    case "team:leave":
      // Any team member can leave (with lead restriction in service).
      if (roles.size > 0) return { allowed: true };
      return { allowed: false, reason: "not_team_member" };

    default:
      return { allowed: false, reason: "unknown_action" };
  }
}

/**
 * Convenience: check + throw ForbiddenError if not allowed.
 */
export async function guardProject(
  userId: string,
  action: ProjectAction,
  projectId?: string,
  isSubmitter = false,
): Promise<ProjectActor> {
  const actor = await loadProjectActor(userId);
  if (!actor) {
    throw new (await import("@/lib/errors")).ForbiddenError("actor not found");
  }
  const result = authorizeProject(actor, action, projectId, isSubmitter);
  if (!result.allowed) {
    throw new (await import("@/lib/errors")).ForbiddenError(result.reason ?? "access denied");
  }
  return actor;
}
