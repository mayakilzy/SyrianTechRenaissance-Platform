/**
 * STR Integrations — Service Layer (G07)
 * ---------------------------------------
 * Provider Registry + Connection Lifecycle + Job Submission + Event Handling
 *
 * Per MASTER G07 directive:
 * - Project-scoped connections (per-project authorization)
 * - Idempotent job submission (unique key per connection+key)
 * - Cancel/Revoke/Suspend with blocking of new operations
 * - Webhook HMAC verification + replay prevention
 * - Rate limiting (simple in-memory per project+connection)
 * - No SSRF (mock adapter only; no arbitrary URLs)
 * - Audit events for execution/failure/cancellation
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
import { createHash, randomBytes } from "node:crypto";
import { isAdmin } from "@/modules/organizations/service";
import { loadProjectContext } from "@/modules/projects/service";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const connectionCreateSchema = z.object({
  providerId: z.string().min(1),
  projectId: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});
export type ConnectionCreateInput = z.infer<typeof connectionCreateSchema>;

export const jobSubmitSchema = z.object({
  connectionId: z.string().min(1),
  capability: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
});
export type JobSubmitInput = z.infer<typeof jobSubmitSchema>;

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter (per project+connection)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 jobs per minute per connection
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(projectId: string, connectionId: string): void {
  const key = `${projectId}:${connectionId}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    throw new ConflictError("Rate limit exceeded: too many job submissions for this connection");
  }
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

export async function listProviders(actorId: string) {
  // Any authenticated user can see the tool directory
  const providers = await db.integrationProvider.findMany({
    include: {
      capabilities: true,
    },
    orderBy: { displayName: "asc" },
  });
  return providers;
}

export async function approveProvider(providerId: string, approverId: string) {
  if (!(await isAdmin(approverId))) {
    throw new ForbiddenError("Only admins can approve providers");
  }
  const result = await db.integrationProvider.updateMany({
    where: { id: providerId, trustStatus: "registered" },
    data: { trustStatus: "approved", approvedById: approverId, approvedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Provider is not in 'registered' status (concurrent transition)");
  }
  await db.auditEvent.create({
    data: {
      actorId: approverId,
      action: "provider.approve",
      targetType: "IntegrationProvider",
      targetId: providerId,
      outcome: "success",
    },
  });
  logger.info("integrations.provider.approved", { providerId, approverId });
  return { id: providerId, trustStatus: "approved" as const };
}

// ---------------------------------------------------------------------------
// Connection Lifecycle
// ---------------------------------------------------------------------------

export async function createConnection(creatorId: string, input: ConnectionCreateInput) {
  const valid = connectionCreateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid connection data", fields);
  }
  // Verify the provider is approved
  const provider = await db.integrationProvider.findUnique({
    where: { id: valid.data.providerId },
    include: { capabilities: true },
  });
  if (!provider) throw new NotFoundError("Provider not found");
  if (provider.trustStatus !== "approved") {
    throw new ConflictError(`Provider is ${provider.trustStatus}; cannot create connections`);
  }
  // Verify the creator is project lead/steward/admin
  const ctx = await loadProjectContext(valid.data.projectId, creatorId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  if (ctx.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${ctx.project.status}; cannot create connections`);
  }
  // Check for existing connection (unique constraint)
  const existing = await db.integrationConnection.findUnique({
    where: {
      providerId_subjectKind_subjectId: {
        providerId: valid.data.providerId,
        subjectKind: "project",
        subjectId: valid.data.projectId,
      },
    },
  });
  if (existing && existing.status !== "revoked") {
    throw new ConflictError("An active connection already exists for this project+provider");
  }
  // Generate a per-connection webhook signing secret
  const webhookSecret = randomBytes(32).toString("hex");
  const webhookSecretHash = createHash("sha256").update(webhookSecret).digest("hex");

  // Create the connection
  const connection = await db.integrationConnection.create({
    data: {
      providerId: valid.data.providerId,
      subjectKind: "project",
      subjectId: valid.data.projectId,
      status: "active",
      scopes: valid.data.scopes,
      webhookSecretHash,
      // credentialReferenceId — for mock, we use a placeholder; real providers need a real credential ref
      credentialReferenceId: `mock-cred-${valid.data.projectId}`,
    },
  });

  // Store the plaintext secret temporarily in the response (never in DB plaintext)
  // The caller must store this; it won't be retrievable later
  logger.info("integrations.connection.created", {
    connectionId: connection.id,
    providerId: valid.data.providerId,
    projectId: valid.data.projectId,
    creatorId,
  });

  return {
    connection,
    webhookSecret, // returned ONCE — caller must store securely
  };
}

export async function revokeConnection(connectionId: string, actorId: string, reason: string) {
  if (reason.trim().length < 10) {
    throw new ValidationError("Revocation reason must be at least 10 characters");
  }
  const conn = await db.integrationConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) throw new NotFoundError("Connection not found");
  // Verify the actor is authorized (project lead/steward/admin for project-scoped connections)
  if (conn.subjectKind === "project") {
    const ctx = await loadProjectContext(conn.subjectId, actorId);
    if (!ctx || (!ctx.isLead && !ctx.isSteward && !ctx.isAdmin)) {
      throw new NotFoundError("Connection not found");
    }
  }
  if (conn.status === "revoked") {
    throw new ConflictError("Connection is already revoked");
  }
  const result = await db.integrationConnection.updateMany({
    where: { id: connectionId, status: { not: "revoked" } },
    data: { status: "revoked", revokedAt: new Date(), revokedReason: reason },
  });
  if (result.count === 0) {
    throw new ConflictError("Connection is no longer revocable (concurrent transition)");
  }
  // Cancel all queued/running jobs for this connection
  await db.integrationJob.updateMany({
    where: { connectionId, status: { in: ["queued", "running"] } },
    data: { status: "cancelled", cancelReason: `Connection revoked: ${reason}`, finishedAt: new Date() },
  });
  await db.auditEvent.create({
    data: {
      actorId,
      action: "connection.revoke",
      targetType: "IntegrationConnection",
      targetId: connectionId,
      outcome: "success",
      reason,
    },
  });
  logger.info("integrations.connection.revoked", { connectionId, actorId });
  return { id: connectionId, status: "revoked" as const };
}

export async function suspendConnection(connectionId: string, actorId: string, reason: string) {
  if (reason.trim().length < 10) {
    throw new ValidationError("Suspension reason must be at least 10 characters");
  }
  const conn = await db.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new NotFoundError("Connection not found");
  if (conn.subjectKind === "project") {
    const ctx = await loadProjectContext(conn.subjectId, actorId);
    if (!ctx || (!ctx.isLead && !ctx.isSteward && !ctx.isAdmin)) {
      throw new NotFoundError("Connection not found");
    }
  }
  if (conn.status !== "active") {
    throw new ConflictError(`Connection is ${conn.status}; cannot suspend`);
  }
  const result = await db.integrationConnection.updateMany({
    where: { id: connectionId, status: "active" },
    data: { status: "suspended", suspendedAt: new Date(), suspendedReason: reason },
  });
  if (result.count === 0) {
    throw new ConflictError("Connection is no longer active (concurrent transition)");
  }
  await db.auditEvent.create({
    data: {
      actorId,
      action: "connection.suspend",
      targetType: "IntegrationConnection",
      targetId: connectionId,
      outcome: "success",
      reason,
    },
  });
  logger.info("integrations.connection.suspended", { connectionId, actorId });
  return { id: connectionId, status: "suspended" as const };
}

export async function listConnections(projectId: string, actorId: string) {
  const ctx = await loadProjectContext(projectId, actorId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  return db.integrationConnection.findMany({
    where: { subjectKind: "project", subjectId: projectId },
    include: { provider: { select: { id: true, displayName: true, isMock: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Job Submission + Lifecycle
// ---------------------------------------------------------------------------

export async function submitJob(submitterId: string, input: JobSubmitInput) {
  const valid = jobSubmitSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid job data", fields);
  }
  // Find the connection
  const conn = await db.integrationConnection.findUnique({
    where: { id: valid.data.connectionId },
    include: { provider: { include: { capabilities: true } } },
  });
  if (!conn) throw new NotFoundError("Connection not found");
  // Cross-project isolation: verify the submitter is a project participant
  if (conn.subjectKind === "project") {
    const ctx = await loadProjectContext(conn.subjectId, submitterId);
    if (!ctx) throw new NotFoundError("Connection not found");
    if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
      throw new NotFoundError("Connection not found");
    }
    // Rate limit
    checkRateLimit(conn.subjectId, conn.id);
  }
  // Connection must be active
  if (conn.status !== "active") {
    throw new ConflictError(`Connection is ${conn.status}; cannot submit jobs`);
  }
  // Find the capability to get timeoutMs
  const capability = conn.provider.capabilities.find((c) => c.code === valid.data.capability);
  if (!capability) {
    throw new UnprocessableEntityError(`Capability ${valid.data.capability} not found for provider ${conn.provider.id}`);
  }
  // Idempotency: check if a job with the same idempotencyKey already exists
  const existing = await db.integrationJob.findUnique({
    where: {
      connectionId_idempotencyKey: {
        connectionId: conn.id,
        idempotencyKey: valid.data.idempotencyKey,
      },
    },
  });
  if (existing) {
    // Idempotent: return the existing job (don't create a duplicate)
    return existing;
  }
  // Create the job
  const job = await db.integrationJob.create({
    data: {
      connectionId: conn.id,
      capability: valid.data.capability,
      initiatorId: submitterId,
      subjectKind: conn.subjectKind,
      subjectId: conn.subjectId,
      status: "queued",
      idempotencyKey: valid.data.idempotencyKey,
      payload: valid.data.payload as never,
      timeoutMs: capability.timeoutMs,
    },
  });
  // Create an OutboxEvent for the worker to pick up
  await db.outboxEvent.create({
    data: {
      aggregate: "integration.job",
      aggregateId: job.id,
      type: "integration.job.submitted",
      payload: { jobId: job.id, capability: valid.data.capability },
    },
  });
  logger.info("integrations.job.submitted", { jobId: job.id, connectionId: conn.id, capability: valid.data.capability });
  return job;
}

export async function getJob(jobId: string, actorId: string) {
  const job = await db.integrationJob.findUnique({
    where: { id: jobId },
    include: { connection: true },
  });
  if (!job) throw new NotFoundError("Job not found");
  // Cross-project isolation: verify the actor is a project participant
  if (job.subjectKind === "project") {
    const ctx = await loadProjectContext(job.subjectId, actorId);
    if (!ctx) throw new NotFoundError("Job not found");
    if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
      throw new NotFoundError("Job not found");
    }
  }
  return job;
}

export async function cancelJob(jobId: string, actorId: string, reason: string) {
  if (reason.trim().length < 5) {
    throw new ValidationError("Cancel reason must be at least 5 characters");
  }
  const job = await db.integrationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError("Job not found");
  if (job.subjectKind === "project") {
    const ctx = await loadProjectContext(job.subjectId, actorId);
    if (!ctx) throw new NotFoundError("Job not found");
    if (!ctx.isLead && !ctx.isSteward && !ctx.isAdmin) {
      throw new NotFoundError("Job not found");
    }
  }
  if (!["queued", "running"].includes(job.status)) {
    throw new ConflictError(`Job is ${job.status}; cannot cancel`);
  }
  const result = await db.integrationJob.updateMany({
    where: { id: jobId, status: { in: ["queued", "running"] } },
    data: { status: "cancelled", cancelReason: reason, cancelledById: actorId, finishedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ConflictError("Job is no longer cancellable (concurrent transition)");
  }
  logger.info("integrations.job.cancelled", { jobId, actorId });
  return { id: jobId, status: "cancelled" as const };
}

// ---------------------------------------------------------------------------
// Webhook Event Receiver
// ---------------------------------------------------------------------------

export async function receiveWebhookEvent(params: {
  providerId: string;
  connectionId?: string;
  providerEventId: string;
  type: string;
  payload: unknown;
  signatureValid: boolean;
}) {
  // Dedupe by (providerId, providerEventId) — replay prevention
  try {
    const event = await db.integrationEvent.create({
      data: {
        providerId: params.providerId,
        providerEventId: params.providerEventId,
        connectionId: params.connectionId ?? null,
        type: params.type,
        payload: params.payload,
        signatureValid: params.signatureValid,
      },
    });
    logger.info("integrations.event.received", {
      eventId: event.id,
      providerId: params.providerId,
      type: params.type,
      signatureValid: params.signatureValid,
    });
    return event;
  } catch (e: unknown) {
    // Unique constraint violation — duplicate event (replay attack or retry)
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      throw new ConflictError("Duplicate event — already received (replay prevention)");
    }
    throw e;
  }
}
