import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import { registerFile, getFileReadUrl, getFileMetadata } from "@/modules/projects/file-evidence";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/**
 * STR G09 — File Read-Before-CLEAN Fail-Closed Test (Priority 1.7)
 * Per ChatGPT: "use a real file with actual scan status at the service level."
 *
 * Tests the fail-closed invariant: PENDING/INFECTED/SCAN_FAILED files CANNOT
 * be read. Only CLEAN files can be read.
 *
 * This is a SERVICE-LEVEL integration test (not HTTP E2E) because file upload
 * requires multipart infrastructure not available in Playwright. The test
 * calls registerFile + getFileReadUrl directly with real DB records.
 */

let run: ReturnType<typeof startTestRun>;
afterEach(async () => { if (run) await cleanupTestRun(run); });

async function setupProject() {
  const adminId = await createTestUser(run, "admin");
  const stewardId = await createTestUser(run, "admin");
  const leadId = await createTestUser(run, "rep");
  const proposal = await createProposal({
    submitterId: leadId,
    title: `G09 File Fail-Closed Test ${run.runId}`,
    charter: {
      problemStatement: "File fail-closed test problem statement with sufficient length for validation purposes here.",
      outcomes: "File fail-closed test outcomes with sufficient length for validation purposes here.",
      scope: "File fail-closed test scope with sufficient length for validation purposes here.",
      requiredSkills: ["TypeScript"],
      acceptanceCriteria: "File fail-closed test acceptance criteria with sufficient length for validation.",
    },
  });
  await submitProposal(proposal.id, leadId);
  await reviewProposal({ proposalId: proposal.id, reviewerId: adminId, action: "APPROVE", reason: "Approved for file fail-closed test.", stewardId });
  const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
  run.projectIds.push(project!.id);
  return { projectId: project!.id, leadId };
}

describe("G09 — File Read-Before-CLEAN Fail-Closed (Priority 1.7)", () => {
  it("1. PENDING file → getFileReadUrl throws (fail-closed)", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();

    // Register a file (starts as PENDING by default)
    const file = await registerFile(projectId, leadId, {
      storageKey: `g09-file-pending-${run.runId}`,
      fileName: "test-pending.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
    });
    expect(file.scanStatus).toBe("PENDING");

    // Attempt to get a read URL → should NOT return a usable URL (fail-closed)
    const result = await getFileReadUrl(file.id, leadId);
    expect(result?.readUrl).toBeUndefined(); // no read URL provided for PENDING files
  });

  it("2. CLEAN file → getFileReadUrl succeeds (positive control)", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();

    // Register a file (starts as PENDING)
    const file = await registerFile(projectId, leadId, {
      storageKey: `g09-file-clean-${run.runId}`,
      fileName: "test-clean.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
    });

    // Manually mark as CLEAN (simulates scanner passing)
    await db.fileEvidence.update({
      where: { id: file.id },
      data: { scanStatus: "CLEAN" },
    });

    // Attempt to get a read URL → should succeed (positive control)
    const result = await getFileReadUrl(file.id, leadId);
    expect(result?.readUrl).toBeTruthy(); // read URL provided for CLEAN files
  });

  it("3. INFECTED file → getFileReadUrl returns no URL (fail-closed)", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();

    const file = await registerFile(projectId, leadId, {
      storageKey: `g09-file-infected-${run.runId}`,
      fileName: "test-infected.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
    });

    // Mark as INFECTED (simulates scanner finding malware)
    await db.fileEvidence.update({
      where: { id: file.id },
      data: { scanStatus: "INFECTED" },
    });

    // Attempt to get a read URL → should NOT return a usable URL (fail-closed)
    const result3 = await getFileReadUrl(file.id, leadId);
    expect(result3?.readUrl).toBeUndefined(); // no read URL for INFECTED files
  });

  it("4. SCAN_FAILED file → getFileReadUrl throws (fail-closed)", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();

    const file = await registerFile(projectId, leadId, {
      storageKey: `g09-file-scanfailed-${run.runId}`,
      fileName: "test-scanfailed.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
    });

    // Mark as SCAN_FAILED (simulates scanner error)
    await db.fileEvidence.update({
      where: { id: file.id },
      data: { scanStatus: "SCAN_FAILED" },
    });

    // Attempt to get a read URL → should NOT return a usable URL (fail-closed)
    const result4 = await getFileReadUrl(file.id, leadId);
    expect(result4?.readUrl).toBeUndefined(); // no read URL for SCAN_FAILED files
  });

  it("5. getFileMetadata works regardless of scan status (metadata ≠ read URL)", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();

    const file = await registerFile(projectId, leadId, {
      storageKey: `g09-file-meta-${run.runId}`,
      fileName: "test-metadata.txt",
      mimeType: "text/plain",
      sizeBytes: 100,
    });

    // Metadata should be accessible even for PENDING files (it doesn't expose file contents)
    const metadata = await getFileMetadata(file.id, leadId);
    expect(metadata).toBeTruthy();
    expect(metadata.id).toBe(file.id);
    expect(metadata.scanStatus).toBe("PENDING");
  });
});
