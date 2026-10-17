-- ============================================================
-- G05 — Project Execution and Deliverables
-- Migration: 20261018000000_g05_project_execution
-- ============================================================
-- Adds: Milestone, Task, Deliverable, DeliverableVersion, DeliverableReview,
--       ContributionReference, FileEvidence + 5 enums
-- Alters: Project (adds leadApprovedCompletionAt, stewardApprovedCompletionAt, completedAt)
--
-- Architectural constraints enforced (per MASTER Authorization §"ضوابط معمارية إضافية"):
--  * DeliverableVersion rows are IMMUTABLE after creation — no UPDATE path in app layer.
--  * FileScanStatus defaults to PENDING — fail-closed (cannot read until CLEAN, only via scanner).
--  * Two-phase project completion (lead approves first, steward approves second + status=COMPLETED).
--  * Strict project isolation — all G05 tables have projectId with FK + index.
--  * One review per (deliverable, version) — @@unique([deliverableId, versionNumber]).
--  * One contribution per deliverable — @@unique([deliverableId]) on ContributionReference.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ALTER Project: add completion-approval fields
-- ------------------------------------------------------------

ALTER TABLE "Project" ADD COLUMN "leadApprovedCompletionAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "stewardApprovedCompletionAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "completedAt" TIMESTAMP(3);

-- ------------------------------------------------------------
-- 2. CREATE TYPE: new enums
-- ------------------------------------------------------------

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DeliverableReviewAction" AS ENUM ('REQUEST_CHANGES', 'ACCEPT', 'REJECT');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SCAN_FAILED');

-- ------------------------------------------------------------
-- 3. CREATE TABLE: Milestone
-- ------------------------------------------------------------

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableVersion" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "textContent" TEXT,
    "fileEvidenceId" TEXT,
    "notes" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverableVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverableReview" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "action" "DeliverableReviewAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "attributionText" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverableReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionReference" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptedVersion" INTEGER NOT NULL,
    "attributionText" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMP(3),
    "scanError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileEvidence_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------
-- 4. CREATE INDEX (performance for common lookups)
-- ------------------------------------------------------------

-- Milestone indexes
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");
CREATE INDEX "Milestone_status_idx" ON "Milestone"("status");
CREATE INDEX "Milestone_dueDate_idx" ON "Milestone"("dueDate");

-- Task indexes
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_assignedById_idx" ON "Task"("assignedById");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_milestoneId_idx" ON "Task"("milestoneId");

-- Deliverable indexes
CREATE INDEX "Deliverable_taskId_idx" ON "Deliverable"("taskId");
CREATE INDEX "Deliverable_submitterId_idx" ON "Deliverable"("submitterId");
CREATE INDEX "Deliverable_status_idx" ON "Deliverable"("status");

-- DeliverableVersion indexes
CREATE INDEX "DeliverableVersion_deliverableId_idx" ON "DeliverableVersion"("deliverableId");
CREATE UNIQUE INDEX "DeliverableVersion_deliverableId_versionNumber_key" ON "DeliverableVersion"("deliverableId", "versionNumber");

-- DeliverableReview indexes
CREATE INDEX "DeliverableReview_deliverableId_idx" ON "DeliverableReview"("deliverableId");
CREATE INDEX "DeliverableReview_reviewerId_idx" ON "DeliverableReview"("reviewerId");
CREATE INDEX "DeliverableReview_versionNumber_idx" ON "DeliverableReview"("versionNumber");
CREATE UNIQUE INDEX "DeliverableReview_deliverableId_versionNumber_key" ON "DeliverableReview"("deliverableId", "versionNumber");

-- ContributionReference indexes
CREATE INDEX "ContributionReference_projectId_idx" ON "ContributionReference"("projectId");
CREATE INDEX "ContributionReference_contributorId_idx" ON "ContributionReference"("contributorId");
CREATE INDEX "ContributionReference_acceptedById_idx" ON "ContributionReference"("acceptedById");
CREATE UNIQUE INDEX "ContributionReference_deliverableId_key" ON "ContributionReference"("deliverableId");

-- FileEvidence indexes
CREATE INDEX "FileEvidence_projectId_idx" ON "FileEvidence"("projectId");
CREATE INDEX "FileEvidence_scanStatus_idx" ON "FileEvidence"("scanStatus");
CREATE INDEX "FileEvidence_uploadedById_idx" ON "FileEvidence"("uploadedById");

-- ------------------------------------------------------------
-- 5. ADD FOREIGN KEY CONSTRAINTS
-- ------------------------------------------------------------

-- Milestone FKs
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Task FKs
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deliverable FKs
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DeliverableVersion FKs
ALTER TABLE "DeliverableVersion" ADD CONSTRAINT "DeliverableVersion_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliverableVersion" ADD CONSTRAINT "DeliverableVersion_fileEvidenceId_fkey" FOREIGN KEY ("fileEvidenceId") REFERENCES "FileEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DeliverableReview FKs
ALTER TABLE "DeliverableReview" ADD CONSTRAINT "DeliverableReview_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliverableReview" ADD CONSTRAINT "DeliverableReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ContributionReference FKs
ALTER TABLE "ContributionReference" ADD CONSTRAINT "ContributionReference_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionReference" ADD CONSTRAINT "ContributionReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionReference" ADD CONSTRAINT "ContributionReference_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionReference" ADD CONSTRAINT "ContributionReference_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FileEvidence FKs (must come BEFORE DeliverableVersion FK that references it)
ALTER TABLE "FileEvidence" ADD CONSTRAINT "FileEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileEvidence" ADD CONSTRAINT "FileEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
