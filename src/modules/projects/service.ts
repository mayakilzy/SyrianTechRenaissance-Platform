/**
 * STR Projects — Project Execution Service (G05)
 * ------------------------------------------------
 * Implements the project execution lifecycle:
 *
 *   Milestone:  PLANNED → IN_PROGRESS → COMPLETED | CANCELLED
 *   Task:       ASSIGNED → IN_PROGRESS → SUBMITTED → (CHANGES_REQUESTED → SUBMITTED)*
 *               → ACCEPTED | REJECTED | WITHDRAWN
 *   Project:    ACTIVE → (lead approves) → (steward approves) → COMPLETED
 *
 * Architectural constraints enforced (per MASTER Authorization Directive):
 *   1. Strict project isolation — every function verifies actor is a project participant.
 *   2. Two-phase project completion — lead approves first, steward approves second
 *      (atomic transition to COMPLETED via updateMany WHERE status=ACTIVE).
 *   3. Reviewer = lead or steward ONLY in G05 (delegation deferred to G06).
 *   4. Anti-self-approval: reviewer of a deliverable cannot be the task's assignee.
 *      Project completion: lead !== steward (enforced by STR-GOV-TEAM-01 at creation).
 *   5. Withdraw (executor) vs Cancel (admin) — separate state transitions, separate APIs.
 *   6. Optimistic lock on every state transition (updateMany WHERE status=X → count check).
 *   7. Notifications are best-effort (try/catch — never block the main operation).
 *   8. Anonymous → 401, unauthorized authenticated → 404 (not 403, no ID enumeration).
 *
 * See STR_G05_EXECUTION_PLAN.md and https://github.com/mayakilzy/repo-info/blob/main/SyrianTechRenaissance/Platform/missions/G05-Project-Execution-and-Deliverables.md
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@/lib/errors";
import { z } from "zod/v4";
import { notify } from "@/modules/notifications/service";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// Type for the project payload with team+memberships included (used by loadProjectContext)
type ProjectWithTeam = Prisma.ProjectGetPayload<{
  include: {
    team: { include: { memberships: { where: { leftAt: null } } } };
  };
}>;

export const milestoneCreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(10000),
  dueDate: z.string().datetime().optional(), // ISO 8601
});
export type MilestoneCreateInput = z.infer<typeof milestoneCreateSchema>;

export const milestoneUpdateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(10).max(10000).optional(),
  dueDate: z.string().datetime().optional().or(z.null()),
});
export type MilestoneUpdateInput = z.infer<typeof milestoneUpdateSchema>;

export const taskCreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(10000),
  assigneeId: z.string().min(1),
  milestoneId: z.string().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

// ---------------------------------------------------------------------------
// Authorization helpers (project-scoped)
// ---------------------------------------------------------------------------

/**
 * Load a project participant context: the project + the actor's roles in it.
 * Returns null if the project doesn't exist (caller should throw NotFoundError).
 * Returns { project, isLead, isSteward, isMember, isAdmin }.
 */
export async function loadProjectContext(
  projectId: string,
  userId: string,
): Promise<{
  project: ProjectWithTeam;
  isLead: boolean;
  isSteward: boolean;
  isMember: boolean;
  isAdmin: boolean;
} | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      team: { include: { memberships: { where: { leftAt: null } } } },
    },
  });
  if (!project) return null;

  // Admin global role check (independent of project roles)
  const adminGrant = await db.roleGrant.findFirst({
    where: { userId, role: "admin", scope: "global", revokedAt: null },
  });
  const isAdmin = !!adminGrant;

  const isLead = project.leadId === userId;
  const isSteward = project.stewardId === userId;
  const isMember =
    project.team?.memberships.some((m) => m.userId === userId) ?? false;

  return { project, isLead, isSteward, isMember, isAdmin };
}

/**
 * Assert the user is at least a team participant (lead, steward, member, or admin).
 * Throws NotFoundError if the project doesn't exist (no ID enumeration leak).
 * Throws ForbiddenError if the user is not a participant.
 */
async function assertProjectParticipant(
  projectId: string,
  userId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof loadProjectContext>>>> {
  const ctx = await loadProjectContext(projectId, userId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    // NotFound (not Forbidden) to avoid ID enumeration — matches G03/G04 pattern.
    throw new NotFoundError("Project not found");
  }
  return ctx;
}

/**
 * Assert the user can manage the project (lead, steward, or admin).
 */
async function assertProjectManager(
  projectId: string,
  userId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof loadProjectContext>>>> {
  const ctx = await assertProjectParticipant(projectId, userId);
  if (!ctx.isLead && !ctx.isSteward && !ctx.isAdmin) {
    throw new ForbiddenError("Only the project lead or steward can perform this action");
  }
  return ctx;
}

/**
 * Assert the project is in an ACTIVE state (not SUSPENDED/CANCELLED/COMPLETED).
 * Required for any work-creation or state-transition operation.
 */
function assertProjectActive(project: { status: string }): void {
  if (project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${project.status}; cannot perform work operations`);
  }
}

// ---------------------------------------------------------------------------
// Milestone CRUD
// ---------------------------------------------------------------------------

export async function createMilestone(
  projectId: string,
  actorId: string,
  input: MilestoneCreateInput,
) {
  const valid = milestoneCreateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid milestone data", fields);
  }
  const ctx = await assertProjectManager(projectId, actorId);
  assertProjectActive(ctx.project);

  const milestone = await db.milestone.create({
    data: {
      projectId,
      title: valid.data.title,
      description: valid.data.description,
      dueDate: valid.data.dueDate ? new Date(valid.data.dueDate) : null,
    },
  });

  logger.info("projects.milestone.created", {
    milestoneId: milestone.id,
    projectId,
    actorId,
  });
  return milestone;
}

export async function listMilestones(projectId: string, actorId: string) {
  await assertProjectParticipant(projectId, actorId);
  return db.milestone.findMany({
    where: { projectId },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { tasks: true } } },
  });
}

export async function getMilestone(milestoneId: string, actorId: string) {
  const milestone = await db.milestone.findUnique({
    where: { id: milestoneId },
    include: {
      project: {
        include: {
          team: {
            include: {
              memberships: { where: { leftAt: null } },
            },
          },
        },
      },
    },
  });
  if (!milestone) throw new NotFoundError("Milestone not found");
  await assertProjectParticipant(milestone.projectId, actorId);
  return milestone;
}

export async function updateMilestone(
  milestoneId: string,
  actorId: string,
  input: MilestoneUpdateInput,
) {
  const valid = milestoneUpdateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid milestone update", fields);
  }
  const milestone = await db.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError("Milestone not found");
  await assertProjectManager(milestone.projectId, actorId);
  // Only PLANNED milestones can be edited (after start, fields are immutable)
  if (milestone.status !== "PLANNED") {
    throw new ConflictError(`Milestone is ${milestone.status}; cannot edit`);
  }
  const updated = await db.milestone.update({
    where: { id: milestoneId },
    data: {
      ...(valid.data.title !== undefined && { title: valid.data.title }),
      ...(valid.data.description !== undefined && { description: valid.data.description }),
      ...(valid.data.dueDate !== undefined && {
        dueDate: valid.data.dueDate ? new Date(valid.data.dueDate) : null,
      }),
    },
  });
  logger.info("projects.milestone.updated", { milestoneId, actorId });
  return updated;
}

/**
 * Transition a milestone PLANNED → IN_PROGRESS.
 * Atomic with optimistic lock.
 */
export async function startMilestone(milestoneId: string, actorId: string) {
  const milestone = await db.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError("Milestone not found");
  await assertProjectManager(milestone.projectId, actorId);

  const result = await db.milestone.updateMany({
    where: { id: milestoneId, status: "PLANNED" },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Milestone is no longer in PLANNED status (concurrent transition)");
  }
  logger.info("projects.milestone.started", { milestoneId, actorId });
  return { id: milestoneId, status: "IN_PROGRESS" as const };
}

/**
 * Transition a milestone IN_PROGRESS → COMPLETED.
 * Atomic with optimistic lock.
 */
export async function completeMilestone(milestoneId: string, actorId: string) {
  const milestone = await db.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError("Milestone not found");
  await assertProjectManager(milestone.projectId, actorId);

  const result = await db.milestone.updateMany({
    where: { id: milestoneId, status: "IN_PROGRESS" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Milestone is no longer in IN_PROGRESS status (concurrent transition)");
  }
  logger.info("projects.milestone.completed", { milestoneId, actorId });
  return { id: milestoneId, status: "COMPLETED" as const };
}

/**
 * Cancel a milestone (admin-side: lead or steward).
 * Withdraw-vs-Cancel distinction: Cancel = authorized admin action.
 */
export async function cancelMilestone(milestoneId: string, actorId: string) {
  const milestone = await db.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError("Milestone not found");
  await assertProjectManager(milestone.projectId, actorId);

  // Cannot cancel an already-terminal milestone
  if (milestone.status === "COMPLETED" || milestone.status === "CANCELLED") {
    throw new ConflictError(`Milestone is already ${milestone.status}`);
  }
  const result = await db.milestone.updateMany({
    where: {
      id: milestoneId,
      status: { in: ["PLANNED", "IN_PROGRESS"] },
    },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Milestone is no longer in a cancellable status (concurrent transition)");
  }
  logger.info("projects.milestone.cancelled", { milestoneId, actorId });
  return { id: milestoneId, status: "CANCELLED" as const };
}

// ---------------------------------------------------------------------------
// Task CRUD + lifecycle
// ---------------------------------------------------------------------------

export async function createTask(
  projectId: string,
  actorId: string,
  input: TaskCreateInput,
) {
  const valid = taskCreateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid task data", fields);
  }
  const ctx = await assertProjectManager(projectId, actorId);
  assertProjectActive(ctx.project);

  // Verify assignee is a team member of this project
  const assigneeMembership = ctx.project.team?.memberships.find(
    (m) => m.userId === valid.data.assigneeId,
  );
  if (!assigneeMembership) {
    throw new UnprocessableEntityError(
      "Assignee must be an active member of the project's team",
    );
  }

  // Verify milestone belongs to the project (if provided)
  if (valid.data.milestoneId) {
    const milestone = await db.milestone.findUnique({
      where: { id: valid.data.milestoneId },
      select: { projectId: true, status: true },
    });
    if (!milestone || milestone.projectId !== projectId) {
      throw new UnprocessableEntityError("Milestone not found in this project");
    }
    if (milestone.status === "COMPLETED" || milestone.status === "CANCELLED") {
      throw new ConflictError(`Milestone is ${milestone.status}; cannot add tasks`);
    }
  }

  const task = await db.task.create({
    data: {
      projectId,
      milestoneId: valid.data.milestoneId || null,
      assigneeId: valid.data.assigneeId,
      assignedById: actorId,
      title: valid.data.title,
      description: valid.data.description,
      status: "ASSIGNED",
    },
  });

  // Best-effort notification
  try {
    await notify(
      valid.data.assigneeId,
      "task.assigned",
      "تم تعيين مهمة جديدة لك / New task assigned to you",
      `المشروع: ${ctx.project.title} — المهمة: ${valid.data.title}`,
    );
  } catch (e) {
    logger.warn("projects.task.assigned.notification_failed", {
      taskId: task.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  logger.info("projects.task.created", { taskId: task.id, projectId, actorId });
  return task;
}

export async function listTasks(
  projectId: string,
  actorId: string,
  filter?: {
    assigneeId?: string;
    status?: "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED" | "CHANGES_REQUESTED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
    milestoneId?: string;
  },
) {
  await assertProjectParticipant(projectId, actorId);
  return db.task.findMany({
    where: {
      projectId,
      ...(filter?.assigneeId && { assigneeId: filter.assigneeId }),
      ...(filter?.status && { status: filter.status }),
      ...(filter?.milestoneId && { milestoneId: filter.milestoneId }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      assignee: { select: { id: true, displayName: true, email: true } },
      assignedBy: { select: { id: true, displayName: true, email: true } },
      _count: { select: { deliverables: true } },
    },
  });
}

export async function getTask(taskId: string, actorId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      project: { include: { team: { include: { memberships: { where: { leftAt: null } } } } } },
      assignee: { select: { id: true, displayName: true, email: true } },
      assignedBy: { select: { id: true, displayName: true, email: true } },
      milestone: { select: { id: true, title: true, status: true } },
      deliverables: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { versions: true, reviews: true } } },
      },
    },
  });
  if (!task) throw new NotFoundError("Task not found");
  await assertProjectParticipant(task.projectId, actorId);
  return task;
}

/**
 * Assignee acknowledges the assignment. ASSIGNED → IN_PROGRESS.
 */
export async function acceptTaskAssignment(taskId: string, actorId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, assigneeId: true, status: true, project: { select: { status: true } } },
  });
  if (!task) throw new NotFoundError("Task not found");
  await assertProjectParticipant(task.projectId, actorId);
  if (task.assigneeId !== actorId) {
    throw new ForbiddenError("Only the assignee can accept the task");
  }
  if (task.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${task.project.status}; cannot accept task`);
  }

  const result = await db.task.updateMany({
    where: { id: taskId, status: "ASSIGNED" },
    data: { status: "IN_PROGRESS", acceptedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Task is no longer in ASSIGNED status (concurrent transition)");
  }
  logger.info("projects.task.accepted", { taskId, actorId });
  return { id: taskId, status: "IN_PROGRESS" as const };
}

/**
 * Assignee withdraws from the task. Withdraw-vs-Cancel distinction:
 * Withdraw = executor action (not authorized admin Cancel).
 */
export async function withdrawTask(taskId: string, actorId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, assigneeId: true, status: true },
  });
  if (!task) throw new NotFoundError("Task not found");
  await assertProjectParticipant(task.projectId, actorId);
  // Assignee OR lead/steward can withdraw (lead/steward via separate Cancel flow is not yet implemented;
  // for G05, withdraw covers both cases — assignee withdraws self, or authorized admin withdraws on behalf).
  const ctx = await loadProjectContext(task.projectId, actorId);
  if (!ctx) throw new NotFoundError("Task not found");
  if (task.assigneeId !== actorId && !ctx.isLead && !ctx.isSteward && !ctx.isAdmin) {
    throw new ForbiddenError("Only the assignee or project lead/steward can withdraw");
  }

  // Withdraw is allowed from any non-terminal status
  if (["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(task.status)) {
    throw new ConflictError(`Task is already ${task.status}; cannot withdraw`);
  }
  const result = await db.task.updateMany({
    where: { id: taskId, status: { notIn: ["ACCEPTED", "REJECTED", "WITHDRAWN"] } },
    data: { status: "WITHDRAWN", withdrawnAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Task is no longer in a withdrawable status (concurrent transition)");
  }
  logger.info("projects.task.withdrawn", { taskId, actorId });
  return { id: taskId, status: "WITHDRAWN" as const };
}

// ---------------------------------------------------------------------------
// Project completion — two-phase approval (lead then steward)
// ---------------------------------------------------------------------------

/**
 * Lead approves project completion. Sets leadApprovedCompletionAt.
 * Pre-conditions:
 *   - All milestones are COMPLETED or CANCELLED (no PLANNED/IN_PROGRESS)
 *   - No tasks in ASSIGNED/IN_PROGRESS/SUBMITTED/CHANGES_REQUESTED status
 *   - All deliverables in terminal states (ACCEPTED/REJECTED/WITHDRAWN)
 */
export async function leadApproveCompletion(projectId: string, actorId: string) {
  const ctx = await assertProjectParticipant(projectId, actorId);
  if (!ctx.isLead && !ctx.isAdmin) {
    throw new ForbiddenError("Only the project lead can approve completion (phase 1)");
  }
  if (ctx.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${ctx.project.status}; cannot approve completion`);
  }

  // Verify all pre-conditions for completion
  await assertProjectReadyForCompletion(projectId);

  // Optimistic lock: only set lead approval if not yet set
  const result = await db.project.updateMany({
    where: {
      id: projectId,
      status: "ACTIVE",
      leadApprovedCompletionAt: null,
    },
    data: { leadApprovedCompletionAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError(
      "Project is no longer in a lead-approvable state (already approved or concurrent transition)",
    );
  }
  logger.info("projects.completion.lead_approved", { projectId, actorId });
  return { id: projectId, leadApprovedCompletionAt: new Date().toISOString() };
}

/**
 * Steward approves project completion. Sets stewardApprovedCompletionAt + completedAt + status=COMPLETED.
 * Atomic: only succeeds if lead has already approved.
 */
export async function stewardApproveCompletion(projectId: string, actorId: string) {
  const ctx = await assertProjectParticipant(projectId, actorId);
  if (!ctx.isSteward && !ctx.isAdmin) {
    throw new ForbiddenError("Only the project steward can approve completion (phase 2)");
  }
  if (ctx.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${ctx.project.status}; cannot approve completion`);
  }

  // Anti-self-approval: steward must not be the same as the lead who approved
  if (ctx.project.leadId === ctx.project.stewardId) {
    throw new ConflictError(
      "Project lead and steward are the same user; cannot complete two-phase approval",
    );
  }
  // Verify lead has approved
  if (!ctx.project.leadApprovedCompletionAt) {
    throw new ConflictError("Project lead has not yet approved completion");
  }

  // Re-verify pre-conditions inside the transaction (defensive against concurrent task creation)
  await assertProjectReadyForCompletion(projectId);

  // Atomic transition: ACTIVE + leadApproved → COMPLETED + stewardApproved + completedAt
  const result = await db.project.updateMany({
    where: {
      id: projectId,
      status: "ACTIVE",
      leadApprovedCompletionAt: { not: null },
      stewardApprovedCompletionAt: null,
    },
    data: {
      status: "COMPLETED",
      stewardApprovedCompletionAt: new Date(),
      completedAt: new Date(),
    },
  });
  if (result.count === 0) {
    throw new ConflictError(
      "Project is no longer in a steward-approvable state (concurrent transition or already completed)",
    );
  }
  logger.info("projects.completion.steward_approved", { projectId, actorId });

  // Best-effort notification
  try {
    await notify(
      ctx.project.leadId,
      "project.completed",
      "اكتمل المشروع / Project completed",
      `المشروع "${ctx.project.title}" اكتمل رسمياً بموافقة المشرف المؤسسي.`,
    );
  } catch (e) {
    logger.warn("projects.completion.notification_failed", {
      projectId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { id: projectId, status: "COMPLETED" as const, completedAt: new Date().toISOString() };
}

/**
 * Helper: verify all pre-conditions for project completion are met.
 *   - No milestone in PLANNED or IN_PROGRESS status
 *   - No task in non-terminal status (ASSIGNED/IN_PROGRESS/SUBMITTED/CHANGES_REQUESTED)
 *   - No deliverable in non-terminal status (DRAFT/SUBMITTED/IN_REVIEW/CHANGES_REQUESTED)
 */
async function assertProjectReadyForCompletion(projectId: string): Promise<void> {
  const [openMilestones, openTasks, openDeliverables] = await Promise.all([
    db.milestone.count({
      where: { projectId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    }),
    db.task.count({
      where: {
        projectId,
        status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED"] },
      },
    }),
    db.deliverable.count({
      where: {
        task: { projectId },
        status: { in: ["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] },
      },
    }),
  ]);

  if (openMilestones > 0 || openTasks > 0 || openDeliverables > 0) {
    throw new ConflictError(
      `Project has open work: ${openMilestones} open milestone(s), ${openTasks} open task(s), ${openDeliverables} open deliverable(s)`,
    );
  }
}

/**
 * Get project execution summary (for workspace view).
 */
export async function getProjectWorkspace(projectId: string, actorId: string) {
  const ctx = await assertProjectParticipant(projectId, actorId);
  const [milestones, myTasks, recentDeliverables, contributionsCount] = await Promise.all([
    db.milestone.findMany({
      where: { projectId },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { tasks: true } } },
      take: 50,
    }),
    db.task.findMany({
      where: { projectId, assigneeId: actorId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        deliverables: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { id: true, status: true, currentVersion: true },
        },
      },
    }),
    db.deliverable.findMany({
      where: { task: { projectId } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: {
        task: { select: { id: true, title: true } },
        submitter: { select: { id: true, displayName: true, email: true } },
      },
    }),
    db.contributionReference.count({ where: { projectId } }),
  ]);

  return {
    project: ctx.project,
    milestones,
    myTasks,
    recentDeliverables,
    contributionsCount,
  };
}

/**
 * List contribution references for a project.
 */
export async function listProjectContributions(projectId: string, actorId: string) {
  await assertProjectParticipant(projectId, actorId);
  return db.contributionReference.findMany({
    where: { projectId },
    orderBy: { acceptedAt: "desc" },
    include: {
      contributor: { select: { id: true, displayName: true, email: true } },
      acceptedBy: { select: { id: true, displayName: true, email: true } },
      deliverable: {
        select: {
          id: true,
          currentVersion: true,
          task: { select: { id: true, title: true } },
        },
      },
    },
  });
}

/**
 * List contributions made by the authenticated user across all projects.
 */
export async function listMyContributions(userId: string) {
  return db.contributionReference.findMany({
    where: { contributorId: userId },
    orderBy: { acceptedAt: "desc" },
    include: {
      project: { select: { id: true, title: true, status: true } },
      deliverable: {
        select: {
          id: true,
          currentVersion: true,
          task: { select: { id: true, title: true } },
        },
      },
      acceptedBy: { select: { id: true, displayName: true, email: true } },
    },
  });
}
