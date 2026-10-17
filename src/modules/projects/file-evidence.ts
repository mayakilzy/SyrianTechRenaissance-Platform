/**
 * STR Projects — File Evidence Service (G05)
 * -------------------------------------------
 * Manages file references for project deliverables.
 *
 * STORAGE + SCANNER ARE DEFERRED TO G07 (per MASTER Authorization Directive §1):
 *   - This service creates FileEvidence records (metadata + opaque storageKey).
 *   - The actual object storage backend and ClamAV scanner integration are
 *     G07 work. For G05, the storageKey is provided by the caller (test
 *     harness or future storage adapter).
 *
 * FAIL-CLOSED POLICY:
 *   - All new uploads have scanStatus=PENDING by default.
 *   - PENDING / INFECTED / SCAN_FAILED files CANNOT be read, downloaded,
 *     or used as accepted deliverable evidence.
 *   - Only the scanner (G07, not yet implemented) can transition a file
 *     to CLEAN. There is NO manual or UI path to promote a file to CLEAN.
 *   - Authorized read URLs are issued ONLY when scanStatus === CLEAN.
 *
 * For G05 testing without a real scanner, tests may use a test-only
 * utility to mark files as CLEAN (mimicking the future scanner). This
 * utility is NOT exposed via the production API surface.
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
import { loadProjectContext } from "./service";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const fileUploadSchema = z.object({
  storageKey: z.string().min(1).max(500),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024), // 100MB cap
});
export type FileUploadInput = z.infer<typeof fileUploadSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertFileBelongsToProject(
  fileId: string,
  projectId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof db.fileEvidence.findUnique>>>> {
  const file = await db.fileEvidence.findUnique({ where: { id: fileId } });
  if (!file) throw new NotFoundError("File evidence not found");
  if (file.projectId !== projectId) {
    // NotFound (not Forbidden) to avoid ID enumeration
    throw new NotFoundError("File evidence not found");
  }
  return file;
}

// ---------------------------------------------------------------------------
// File upload (metadata only — actual storage is caller's responsibility)
// ---------------------------------------------------------------------------

/**
 * Register a new file evidence record. scanStatus defaults to PENDING.
 * The caller (typically an API route handling multipart upload) is responsible
 * for storing the actual file bytes in safe object storage and providing the
 * opaque storageKey here. The record will remain in PENDING scan status
 * until G07's scanner processes it.
 */
export async function registerFile(
  projectId: string,
  uploaderId: string,
  input: FileUploadInput,
) {
  const valid = fileUploadSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid file metadata", fields);
  }
  const ctx = await loadProjectContext(projectId, uploaderId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  if (ctx.project.status !== "ACTIVE") {
    throw new ConflictError(`Project is ${ctx.project.status}; cannot upload files`);
  }

  const file = await db.fileEvidence.create({
    data: {
      projectId,
      uploadedById: uploaderId,
      storageKey: valid.data.storageKey,
      fileName: valid.data.fileName,
      mimeType: valid.data.mimeType,
      sizeBytes: valid.data.sizeBytes,
      scanStatus: "PENDING",
    },
  });

  logger.info("projects.file.registered", {
    fileId: file.id,
    projectId,
    uploaderId,
    scanStatus: "PENDING",
  });
  return file;
}

/**
 * Get file metadata. Does NOT return the actual file contents.
 * Reading the file contents requires a signed read URL (see getFileReadUrl).
 */
export async function getFileMetadata(fileId: string, actorId: string) {
  const file = await db.fileEvidence.findUnique({
    where: { id: fileId },
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
  if (!file) throw new NotFoundError("File evidence not found");

  const ctx = await loadProjectContext(file.projectId, actorId);
  if (!ctx) throw new NotFoundError("File evidence not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("File evidence not found");
  }
  return file;
}

/**
 * Get a short-lived signed read URL for a file.
 * FAIL-CLOSED: only issued when scanStatus === CLEAN.
 * In G05, the actual signed URL generation is delegated to the storage
 * adapter (G07). For G05 testing, this returns a placeholder URL only
 * when scanStatus === CLEAN.
 */
export async function getFileReadUrl(fileId: string, actorId: string): Promise<{
  fileId: string;
  fileName: string;
  scanStatus: string;
  readUrl: string | null;
  reason?: string;
}> {
  const file = await getFileMetadata(fileId, actorId);

  if (file.scanStatus !== "CLEAN") {
    return {
      fileId: file.id,
      fileName: file.fileName,
      scanStatus: file.scanStatus,
      readUrl: null,
      reason: `File scan status is ${file.scanStatus}; only CLEAN files can be read (fail-closed)`,
    };
  }

  // G05 placeholder: in G07, this will generate a real signed URL via the
  // storage adapter. For now, return a placeholder opaque URL.
  return {
    fileId: file.id,
    fileName: file.fileName,
    scanStatus: file.scanStatus,
    readUrl: `storage://placeholder/${file.storageKey}?signed=g05-token`,
  };
}

/**
 * List files in a project. Only shows metadata (not contents).
 */
export async function listProjectFiles(projectId: string, actorId: string) {
  const ctx = await loadProjectContext(projectId, actorId);
  if (!ctx) throw new NotFoundError("Project not found");
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    throw new NotFoundError("Project not found");
  }
  return db.fileEvidence.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      uploadedBy: { select: { id: true, displayName: true, email: true } },
      _count: { select: { deliverableVersions: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Test-only utilities (NOT exposed via production API)
// ---------------------------------------------------------------------------

/**
 * TEST-ONLY: Mark a file as CLEAN. Used only by test setup/seed scripts to
 * simulate the future G07 scanner. NEVER call from production code or API
 * routes. Production scan transitions must come from the scanner only.
 *
 * @internal
 */
export async function _testMarkFileAsClean(fileId: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("_testMarkFileAsClean must not be called in production");
  }
  await db.fileEvidence.update({
    where: { id: fileId },
    data: { scanStatus: "CLEAN", scannedAt: new Date() },
  });
  logger.warn("projects.file.test_marked_clean", { fileId, note: "test-only path" });
}

/**
 * TEST-ONLY: Mark a file as INFECTED. Used only by tests to verify the
 * fail-closed policy (file with INFECTED status cannot be read or used
 * as deliverable evidence).
 *
 * @internal
 */
export async function _testMarkFileAsInfected(fileId: string, error?: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("_testMarkFileAsInfected must not be called in production");
  }
  await db.fileEvidence.update({
    where: { id: fileId },
    data: { scanStatus: "INFECTED", scannedAt: new Date(), scanError: error || "test infection" },
  });
  logger.warn("projects.file.test_marked_infected", { fileId, note: "test-only path" });
}
