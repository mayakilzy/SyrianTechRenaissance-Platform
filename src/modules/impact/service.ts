/**
 * STR Impact — Evidence-Backed Impact Records (G06-B)
 * ----------------------------------------------------
 *
 * Impact records are APPEND-ONLY. Corrections are made by creating a new
 * record with supersedesId pointing to the previous one. NO silent edits.
 *
 * Required: metricName + metricValue + (optional but recommended) evidenceUrl
 * No fake metrics — the recordedById field identifies who recorded it and
 * when; the evidenceUrl provides verifiable source.
 *
 * Authorization: lead, steward, or admin can record impact.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ValidationError,
  NotFoundError,
} from "@/lib/errors";
import { z } from "zod/v4";
import { loadProjectContext } from "@/modules/projects/service";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const impactRecordSchema = z.object({
  metricName: z.string().min(2).max(200),
  metricValue: z.number().int(),
  evidenceUrl: z.string().url().max(1000).optional(),
  supersedesId: z.string().optional(), // for corrections
});
export type ImpactRecordInput = z.infer<typeof impactRecordSchema>;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function recordImpact(
  projectId: string,
  recorderId: string,
  input: ImpactRecordInput,
) {
  const valid = impactRecordSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid impact record data", fields);
  }
  const ctx = await loadProjectContext(projectId, recorderId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  // If supersedesId provided, verify the previous record exists + belongs to this project
  if (valid.data.supersedesId) {
    const previous = await db.impactRecord.findUnique({
      where: { id: valid.data.supersedesId },
      select: { projectId: true },
    });
    if (!previous) throw new NotFoundError("Previous impact record not found");
    if (previous.projectId !== projectId) {
      throw new NotFoundError("Previous impact record not found"); // NotFound, not Forbidden
    }
  }
  const record = await db.impactRecord.create({
    data: {
      projectId,
      metricName: valid.data.metricName,
      metricValue: valid.data.metricValue,
      evidenceUrl: valid.data.evidenceUrl || null,
      recordedById: recorderId,
      supersedesId: valid.data.supersedesId || null,
    },
  });
  logger.info("impact.recorded", { impactId: record.id, projectId, recorderId });
  return record;
}

export async function listImpactRecords(projectId: string, actorId: string) {
  const ctx = await loadProjectContext(projectId, actorId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  return db.impactRecord.findMany({
    where: { projectId },
    orderBy: { recordedAt: "desc" },
    include: {
      recordedBy: { select: { id: true, displayName: true, email: true } },
    },
  });
}
