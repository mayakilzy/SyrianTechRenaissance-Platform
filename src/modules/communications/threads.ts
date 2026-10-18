/**
 * STR Communications — Project-Scoped Threads (G06-B)
 * -----------------------------------------------------
 * Threads are project-scoped (no global forum). Lifecycle:
 *   Thread: open → closed (terminal, no delete)
 *   Message: created (immutable body; optional editedAt for edits)
 *
 * Authorization: only project participants (lead, steward, members, admin)
 * can create threads + post messages.
 *
 * Notifications: posting a message notifies other thread participants
 * (best-effort, non-blocking).
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "@/lib/errors";
import { z } from "zod/v4";
import { loadProjectContext } from "@/modules/projects/service";
import { notify } from "@/modules/notifications/service";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const threadCreateSchema = z.object({
  title: z.string().min(3).max(200),
  topic: z.string().max(100).optional(),
  initialMessage: z.string().min(10).max(20000),
});
export type ThreadCreateInput = z.infer<typeof threadCreateSchema>;

export const threadMessageSchema = z.object({
  body: z.string().min(1).max(20000),
});
export type ThreadMessageInput = z.infer<typeof threadMessageSchema>;

// ---------------------------------------------------------------------------
// Thread CRUD
// ---------------------------------------------------------------------------

export async function createThread(
  projectId: string,
  creatorId: string,
  input: ThreadCreateInput,
) {
  const valid = threadCreateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid thread data", fields);
  }
  const ctx = await loadProjectContext(projectId, creatorId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  if (ctx.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${ctx.project.status}; cannot create threads`);
  }
  // Atomic: create thread + initial message in one transaction
  const thread = await db.$transaction(async (tx) => {
    const t = await tx.projectThread.create({
      data: {
        projectId,
        title: valid.data.title,
        topic: valid.data.topic || null,
        createdBy: creatorId,
      },
    });
    await tx.threadMessage.create({
      data: {
        threadId: t.id,
        authorId: creatorId,
        body: valid.data.initialMessage,
      },
    });
    return t;
  });
  logger.info("communications.thread.created", { threadId: thread.id, projectId, creatorId });
  return thread;
}

export async function listThreads(projectId: string, actorId: string) {
  const ctx = await loadProjectContext(projectId, actorId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  return db.projectThread.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { messages: true } },
      creator: { select: { id: true, displayName: true, email: true } },
    },
  });
}

export async function getThread(threadId: string, actorId: string) {
  const thread = await db.projectThread.findUnique({
    where: { id: threadId },
    include: {
      project: {
        include: { team: { include: { memberships: { where: { leftAt: null } } } } },
      },
      creator: { select: { id: true, displayName: true, email: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, displayName: true, email: true } } },
      },
    },
  });
  if (!thread) throw new NotFoundError("Thread not found");
  // Authorization: project participant
  const ctx = await loadProjectContext(thread.projectId, actorId);
  if (!ctx) throw new NotFoundError("Thread not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("Thread not found");
  }
  // G06 moderation correction: hide removed messages from regular users.
  // Admins and moderators can see removed messages (with removedAt indicator)
  // for audit purposes. The original body is preserved for authorized auditors.
  // Regular users see removed messages as "[removed]" placeholders — they
  // know a message was removed, but cannot see the content.
  const adminGrant = await db.roleGrant.findFirst({
    where: { userId: actorId, revokedAt: null, OR: [{ role: "admin" }, { role: "moderator" }] },
  });
  const canSeeRemoved = !!adminGrant || ctx.isAdmin;
  if (!canSeeRemoved) {
    // For regular users: redact removed messages (replace body with placeholder)
    thread.messages = thread.messages.map((m) =>
      m.removedAt ? { ...m, body: "[removed — content hidden by moderation decision]" } : m,
    );
  }
  return thread;
}

export async function postMessage(
  threadId: string,
  authorId: string,
  input: ThreadMessageInput,
) {
  const valid = threadMessageSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid message data", fields);
  }
  const thread = await db.projectThread.findUnique({
    where: { id: threadId },
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
  if (!thread) throw new NotFoundError("Thread not found");
  if (thread.closedAt) {
    throw new ConflictError("Thread is closed; cannot post new messages");
  }
  // Authorization: project participant
  const isParticipant =
    thread.project.leadId === authorId ||
    thread.project.stewardId === authorId ||
    (thread.project.team?.memberships.some((m) => m.userId === authorId) ?? false);
  const adminGrant = await db.roleGrant.findFirst({
    where: { userId: authorId, role: "admin", scope: "global", revokedAt: null },
  });
  if (!isParticipant && !adminGrant) {
    throw new NotFoundError("Thread not found"); // NotFound, not Forbidden
  }
  const message = await db.threadMessage.create({
    data: {
      threadId,
      authorId,
      body: valid.data.body,
    },
  });
  // Update thread's updatedAt
  await db.projectThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });
  // Best-effort notification to the thread creator (if different from author)
  if (thread.createdBy !== authorId) {
    try {
      await notify(
        thread.createdBy,
        "thread.message_posted",
        "رسالة جديدة في المحادثة / New message in thread",
        `${thread.title}: ${valid.data.body.substring(0, 100)}...`,
      );
    } catch (e) {
      logger.warn("communications.thread.message_notification_failed", {
        threadId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  logger.info("communications.message.posted", { messageId: message.id, threadId, authorId });
  return message;
}

export async function closeThread(threadId: string, actorId: string) {
  const thread = await db.projectThread.findUnique({
    where: { id: threadId },
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
  if (!thread) throw new NotFoundError("Thread not found");
  // Authorization: lead, steward, admin, or thread creator
  const isLead = thread.project.leadId === actorId;
  const isSteward = thread.project.stewardId === actorId;
  const isCreator = thread.createdBy === actorId;
  const adminGrant = await db.roleGrant.findFirst({
    where: { userId: actorId, role: "admin", scope: "global", revokedAt: null },
  });
  if (!isLead && !isSteward && !isCreator && !adminGrant) {
    throw new ForbiddenError("Only the lead, steward, admin, or thread creator can close the thread");
  }
  if (thread.closedAt) {
    throw new ConflictError("Thread is already closed");
  }
  const result = await db.projectThread.updateMany({
    where: { id: threadId, closedAt: null },
    data: { closedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Thread was closed concurrently");
  }
  logger.info("communications.thread.closed", { threadId, actorId });
  return { id: threadId, closedAt: new Date().toISOString() };
}
