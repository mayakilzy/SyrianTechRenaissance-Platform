/**
 * STR Teams — Team Membership & Project Governance (G03-FIX)
 * ----------------------------------------------------------
 * Manages team membership after atomic team creation.
 *
 * G03-FIX: suspendProject/reactivateProject now enforce authorization
 * INSIDE the service, not just at the API caller. This prevents any future
 * caller from bypassing the check.
 *
 * NO team creation here — teams are created ONLY by proposal approval.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "@/lib/errors";

// ---------------------------------------------------------------------------
// Authorization helper (G03-FIX §3): INSIDE the service
// ---------------------------------------------------------------------------

/**
 * Verify the actor is the project's steward OR a global admin.
 * Throws ForbiddenError if not. Called INSIDE suspend/reactivate.
 */
async function assertCanGovernProject(projectId: string, actorId: string): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { stewardId: true },
  });
  if (!project) throw new NotFoundError("Project not found");

  // Check if actor is the project's steward.
  if (project.stewardId === actorId) return;

  // Check if actor is a global admin.
  const adminGrant = await db.roleGrant.findFirst({
    where: { userId: actorId, role: "admin", scope: "global", revokedAt: null },
  });
  if (adminGrant) return;

  throw new ForbiddenError("Only the project steward or an admin can govern this project");
}

// ---------------------------------------------------------------------------
// Invite / accept / decline / leave (unchanged)
// ---------------------------------------------------------------------------

export interface InviteInput {
  teamId: string;
  inviterId: string;
  inviteeId: string;
  role: "MEMBER" | "STEWARD";
  message?: string;
}

export async function inviteMember(input: InviteInput) {
  const team = await db.team.findUnique({
    where: { id: input.teamId },
    include: { project: true, memberships: true },
  });
  if (!team) throw new NotFoundError("Team not found");

  const inviterMembership = team.memberships.find(
    (m) => m.userId === input.inviterId && ["LEAD", "STEWARD"].includes(m.role) && !m.leftAt,
  );
  if (!inviterMembership) {
    throw new ForbiddenError("Only the team lead or steward can invite members");
  }
  if (input.inviteeId === input.inviterId) {
    throw new ValidationError("Cannot invite yourself");
  }
  const existingMember = team.memberships.find((m) => m.userId === input.inviteeId && !m.leftAt);
  if (existingMember) {
    throw new ConflictError("User is already a team member");
  }

  try {
    const invitation = await db.teamInvitation.create({
      data: {
        teamId: input.teamId,
        inviteeId: input.inviteeId,
        inviterId: input.inviterId,
        role: input.role,
        message: input.message,
      },
    });
    logger.info("teams.invited", { teamId: input.teamId, inviteeId: input.inviteeId });
    return invitation;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      throw new ConflictError("A pending invitation already exists for this user");
    }
    throw e;
  }
}

export async function acceptInvitation(invitationId: string, userId: string) {
  const invitation = await db.teamInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError("Invitation not found");
  if (invitation.inviteeId !== userId) throw new ForbiddenError("This invitation is not for you");
  if (invitation.status !== "PENDING") throw new ConflictError(`Invitation is already ${invitation.status}`);
  await db.$transaction([
    db.teamInvitation.update({ where: { id: invitationId }, data: { status: "ACCEPTED", respondedAt: new Date() } }),
    db.teamMembership.create({ data: { teamId: invitation.teamId, userId, role: invitation.role } }),
  ]);
  logger.info("teams.invitation.accepted", { invitationId, userId });
}

export async function declineInvitation(invitationId: string, userId: string) {
  const invitation = await db.teamInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError("Invitation not found");
  if (invitation.inviteeId !== userId) throw new ForbiddenError("This invitation is not for you");
  if (invitation.status !== "PENDING") throw new ConflictError(`Invitation is already ${invitation.status}`);
  await db.teamInvitation.update({ where: { id: invitationId }, data: { status: "DECLINED", respondedAt: new Date() } });
  logger.info("teams.invitation.declined", { invitationId, userId });
}

export async function leaveTeam(teamId: string, userId: string) {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership || membership.leftAt) throw new NotFoundError("Membership not found");
  if (membership.role === "LEAD") {
    const otherLeads = await db.teamMembership.count({
      where: { teamId, role: "LEAD", leftAt: null, userId: { not: userId } },
    });
    if (otherLeads === 0) {
      throw new ConflictError("Team lead cannot leave without transferring leadership.");
    }
  }
  await db.teamMembership.update({ where: { id: membership.id }, data: { leftAt: new Date() } });
  logger.info("teams.left", { teamId, userId });
}

// ---------------------------------------------------------------------------
// Suspend / Reactivate (G03-FIX §3: authorization INSIDE the service)
// ---------------------------------------------------------------------------

export async function suspendProject(projectId: string, actorId: string, reason: string) {
  // G03-FIX: enforce authorization INSIDE the service.
  await assertCanGovernProject(projectId, actorId);

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");
  if (project.status !== "ACTIVE") {
    throw new ConflictError(`Project is not active (status: ${project.status})`);
  }

  await db.$transaction([
    db.project.update({ where: { id: projectId }, data: { status: "SUSPENDED", suspendedAt: new Date() } }),
    db.resourceGrant.updateMany({
      where: { projectId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: `Project suspended: ${reason}` },
    }),
  ]);
  logger.info("projects.suspended", { projectId, actorId, reason });
}

export async function reactivateProject(projectId: string, actorId: string) {
  // G03-FIX: enforce authorization INSIDE the service.
  await assertCanGovernProject(projectId, actorId);

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");
  if (project.status !== "SUSPENDED") {
    throw new ConflictError(`Project is not suspended (status: ${project.status})`);
  }
  await db.project.update({ where: { id: projectId }, data: { status: "ACTIVE", suspendedAt: null } });
  logger.info("projects.reactivated", { projectId, actorId });
}

// ---------------------------------------------------------------------------
// Steward / Lead change (G03-FIX §7)
// ---------------------------------------------------------------------------

export interface ChangeStewardInput {
  projectId: string;
  newStewardId: string;
  actorId: string;
}

/**
 * Change the institutional steward for a project.
 * Only an admin can reassign a steward (the current steward cannot
 * self-reassign to avoid leaving the project ungoverned).
 * The new steward must be qualified (admin or steward role).
 */
export async function changeSteward(input: ChangeStewardInput): Promise<void> {
  // Only admins can reassign stewards.
  const adminGrant = await db.roleGrant.findFirst({
    where: { userId: input.actorId, role: "admin", scope: "global", revokedAt: null },
  });
  if (!adminGrant) {
    throw new ForbiddenError("Only admins can reassign stewards");
  }

  // Verify new steward is qualified.
  const newStewardQualified = await db.roleGrant.findFirst({
    where: {
      userId: input.newStewardId,
      revokedAt: null,
      OR: [{ role: "admin", scope: "global" }, { role: "steward", scope: "global" }],
    },
  });
  if (!newStewardQualified) {
    throw new ForbiddenError("New steward is not qualified (requires admin or steward role)");
  }

  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new NotFoundError("Project not found");
  if (input.newStewardId === project.leadId) {
    throw new ForbiddenError("Steward cannot be the same as the lead (separation of duties)");
  }

  await db.$transaction(async (tx) => {
    // Update the existing steward assignment (projectId is unique).
    await tx.stewardAssignment.update({
      where: { projectId: input.projectId },
      data: {
        stewardId: input.newStewardId,
        assignedBy: input.actorId,
        assignedAt: new Date(),
        unassignedAt: null,
      },
    });
    // Update the project's stewardId.
    await tx.project.update({
      where: { id: input.projectId },
      data: { stewardId: input.newStewardId },
    });
  });
  logger.info("projects.steward.changed", { projectId: input.projectId, newStewardId: input.newStewardId, actorId: input.actorId });
}

export interface ChangeLeadInput {
  projectId: string;
  newLeadId: string;
  actorId: string;
}

/**
 * Change the team lead. Only the current lead or the steward can do this.
 * The new lead must be a current team member.
 */
export async function changeLead(input: ChangeLeadInput): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    include: { team: { include: { memberships: true } } },
  });
  if (!project || !project.team) throw new NotFoundError("Project or team not found");

  // Only the current lead or the steward can change the lead.
  const isCurrentLead = project.leadId === input.actorId;
  const isSteward = project.stewardId === input.actorId;
  const isAdmin = await db.roleGrant.findFirst({
    where: { userId: input.actorId, role: "admin", scope: "global", revokedAt: null },
  });
  if (!isCurrentLead && !isSteward && !isAdmin) {
    throw new ForbiddenError("Only the current lead, steward, or admin can change the lead");
  }

  // The new lead must be a current team member.
  const newLeadMembership = project.team.memberships.find(
    (m) => m.userId === input.newLeadId && !m.leftAt,
  );
  if (!newLeadMembership) {
    throw new ValidationError("New lead must be a current team member");
  }

  await db.$transaction([
    // Demote old lead to MEMBER.
    db.teamMembership.updateMany({
      where: { teamId: project.team.id, role: "LEAD", leftAt: null },
      data: { role: "MEMBER" },
    }),
    // Promote new lead.
    db.teamMembership.update({
      where: { id: newLeadMembership.id },
      data: { role: "LEAD" },
    }),
    // Update project's leadId.
    db.project.update({ where: { id: input.projectId }, data: { leadId: input.newLeadId } }),
  ]);
  logger.info("projects.lead.changed", { projectId: input.projectId, newLeadId: input.newLeadId, actorId: input.actorId });
}

// ---------------------------------------------------------------------------
// Get team details
// ---------------------------------------------------------------------------

export async function getTeamForProject(projectId: string) {
  return db.team.findUnique({
    where: { projectId },
    include: {
      project: {
        include: {
          steward: { select: { id: true, displayName: true } },
          lead: { select: { id: true, displayName: true } },
          proposal: { select: { id: true, title: true } },
        },
      },
      memberships: {
        where: { leftAt: null },
        include: { user: { select: { id: true, displayName: true } } },
      },
      invitations: {
        where: { status: "PENDING" },
        include: { invitee: { select: { id: true, displayName: true } } },
      },
    },
  });
}

export async function getUserTeams(userId: string) {
  return db.teamMembership.findMany({
    where: { userId, leftAt: null },
    include: {
      team: {
        include: {
          project: {
            include: {
              proposal: { select: { id: true, title: true } },
              steward: { select: { id: true, displayName: true } },
              lead: { select: { id: true, displayName: true } },
            },
          },
        },
      },
    },
  });
}
