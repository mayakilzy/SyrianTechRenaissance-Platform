/**
 * STR Teams — Team Membership & Invitation Service
 * ------------------------------------------------
 * Manages team membership after a team is created (by proposal approval).
 *
 * NO team creation here — teams are created ONLY by the proposal approval
 * atomic transaction (proposals/service.ts → approveProposal()).
 *
 * Capabilities:
 *   - Invite members (lead + steward only)
 *   - Accept/decline invitations
 *   - Leave team
 *   - Suspend project (steward/admin only) — revokes resource grants
 *
 * See G03 §5,6 and 03-Data-and-Permissions §invariant 4.
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
// Invite a member to a team
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
    include: {
      project: true,
      memberships: true,
    },
  });
  if (!team) throw new NotFoundError("Team not found");

  // Only the lead or steward can invite.
  const inviterMembership = team.memberships.find(
    (m) => m.userId === input.inviterId && m.role in ["LEAD", "STEWARD"] && !m.leftAt,
  );
  if (!inviterMembership) {
    throw new ForbiddenError("Only the team lead or steward can invite members");
  }

  // Can't invite yourself.
  if (input.inviteeId === input.inviterId) {
    throw new ValidationError("Cannot invite yourself");
  }

  // Check if already a member.
  const existingMember = team.memberships.find(
    (m) => m.userId === input.inviteeId && !m.leftAt,
  );
  if (existingMember) {
    throw new ConflictError("User is already a team member");
  }

  // Create invitation (unique constraint prevents duplicate pending invites).
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
    logger.info("teams.invited", { teamId: input.teamId, inviteeId: input.inviteeId, inviterId: input.inviterId });
    return invitation;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      throw new ConflictError("A pending invitation already exists for this user");
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Accept an invitation
// ---------------------------------------------------------------------------

export async function acceptInvitation(invitationId: string, userId: string) {
  const invitation = await db.teamInvitation.findUnique({
    where: { id: invitationId },
  });
  if (!invitation) throw new NotFoundError("Invitation not found");
  if (invitation.inviteeId !== userId) {
    throw new ForbiddenError("This invitation is not for you");
  }
  if (invitation.status !== "PENDING") {
    throw new ConflictError(`Invitation is already ${invitation.status}`);
  }

  await db.$transaction([
    db.teamInvitation.update({
      where: { id: invitationId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    }),
    db.teamMembership.create({
      data: {
        teamId: invitation.teamId,
        userId,
        role: invitation.role,
      },
    }),
  ]);

  logger.info("teams.invitation.accepted", { invitationId, userId, teamId: invitation.teamId });
}

// ---------------------------------------------------------------------------
// Decline an invitation
// ---------------------------------------------------------------------------

export async function declineInvitation(invitationId: string, userId: string) {
  const invitation = await db.teamInvitation.findUnique({
    where: { id: invitationId },
  });
  if (!invitation) throw new NotFoundError("Invitation not found");
  if (invitation.inviteeId !== userId) {
    throw new ForbiddenError("This invitation is not for you");
  }
  if (invitation.status !== "PENDING") {
    throw new ConflictError(`Invitation is already ${invitation.status}`);
  }

  await db.teamInvitation.update({
    where: { id: invitationId },
    data: { status: "DECLINED", respondedAt: new Date() },
  });

  logger.info("teams.invitation.declined", { invitationId, userId });
}

// ---------------------------------------------------------------------------
// Leave a team
// ---------------------------------------------------------------------------

export async function leaveTeam(teamId: string, userId: string) {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    include: { team: { include: { project: true } } },
  });
  if (!membership || membership.leftAt) {
    throw new NotFoundError("Membership not found");
  }

  // The lead cannot leave without transferring leadership (G03 — steward must
  // reassign). For now, block leaving if you're the only lead.
  if (membership.role === "LEAD") {
    const otherLeads = await db.teamMembership.count({
      where: { teamId, role: "LEAD", leftAt: null, userId: { not: userId } },
    });
    if (otherLeads === 0) {
      throw new ConflictError("Team lead cannot leave without transferring leadership. Ask the steward to assign a new lead.");
    }
  }

  await db.teamMembership.update({
    where: { id: membership.id },
    data: { leftAt: new Date() },
  });

  logger.info("teams.left", { teamId, userId });
}

// ---------------------------------------------------------------------------
// Suspend a project (steward/admin only) — revokes resource grants
// ---------------------------------------------------------------------------

export async function suspendProject(projectId: string, actorId: string, reason: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
  });
  if (!project) throw new NotFoundError("Project not found");
  if (project.status !== "ACTIVE") {
    throw new ConflictError(`Project is not active (status: ${project.status})`);
  }

  // Only the steward or an admin can suspend. The steward is stored directly
  // on the Project (stewardId field), set during the atomic approval.
  const isSteward = project.stewardId === actorId;
  // Admin check is done by the caller (authorize service).
  // The caller should verify isSteward OR isAdmin before calling this.

  await db.$transaction([
    db.project.update({
      where: { id: projectId },
      data: { status: "SUSPENDED", suspendedAt: new Date() },
    }),
    // Revoke all active resource grants.
    db.resourceGrant.updateMany({
      where: { projectId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: `Project suspended: ${reason}` },
    }),
  ]);

  logger.info("projects.suspended", { projectId, actorId, reason });
}

// ---------------------------------------------------------------------------
// Reactivate a suspended project
// ---------------------------------------------------------------------------

export async function reactivateProject(projectId: string, actorId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
  });
  if (!project) throw new NotFoundError("Project not found");
  if (project.status !== "SUSPENDED") {
    throw new ConflictError(`Project is not suspended (status: ${project.status})`);
  }

  await db.project.update({
    where: { id: projectId },
    data: { status: "ACTIVE", suspendedAt: null },
  });

  logger.info("projects.reactivated", { projectId, actorId });
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
