-- ============================================================
-- G06-B — Threads, Moderation, Admin, and Impact
-- Migration: 20261019020000_g06b_threads_moderation_impact
-- ============================================================
-- Adds:
--   ProjectThread, ThreadMessage
--   ModerationComplaint, ModerationDecision
--   ImpactRecord (with self-relation for supersession)
--   3 new enums: ModerationStatus, ModerationAction
--
-- Architectural constraints:
--   * CONTENT_REMOVED removes visibility, NOT the row (original preserved)
--   * USER_SUSPENDED requires admin (not moderator alone) + audit event
--   * Threads are project-scoped; close is terminal (no delete)
--   * Impact records are append-only; corrections via supersedesId link
-- ============================================================

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'RESOLVED_WARNING', 'RESOLVED_REMOVED', 'RESOLVED_DISMISSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('WARNING', 'CONTENT_REMOVED', 'USER_SUSPENDED', 'DISMISS', 'ESCALATE');

-- CreateTable
CREATE TABLE "ProjectThread" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "ThreadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationComplaint" (
    "id" TEXT NOT NULL,
    "complainantId" TEXT NOT NULL,
    "projectId" TEXT,
    "threadId" TEXT,
    "targetUserId" TEXT,
    "reason" TEXT NOT NULL,
    "evidenceText" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationDecision" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "deciderId" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" INTEGER NOT NULL,
    "evidenceUrl" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" TEXT,

    CONSTRAINT "ImpactRecord_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "ProjectThread_projectId_idx" ON "ProjectThread"("projectId");
CREATE INDEX "ProjectThread_updatedAt_idx" ON "ProjectThread"("updatedAt");
CREATE INDEX "ThreadMessage_threadId_idx" ON "ThreadMessage"("threadId");
CREATE INDEX "ThreadMessage_authorId_idx" ON "ThreadMessage"("authorId");
CREATE INDEX "ModerationComplaint_projectId_idx" ON "ModerationComplaint"("projectId");
CREATE INDEX "ModerationComplaint_status_idx" ON "ModerationComplaint"("status");
CREATE INDEX "ModerationComplaint_targetUserId_idx" ON "ModerationComplaint"("targetUserId");
CREATE INDEX "ModerationDecision_complaintId_idx" ON "ModerationDecision"("complaintId");
CREATE INDEX "ModerationDecision_deciderId_idx" ON "ModerationDecision"("deciderId");
CREATE INDEX "ImpactRecord_projectId_idx" ON "ImpactRecord"("projectId");
CREATE INDEX "ImpactRecord_metricName_idx" ON "ImpactRecord"("metricName");

-- Foreign keys
ALTER TABLE "ProjectThread" ADD CONSTRAINT "ProjectThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectThread" ADD CONSTRAINT "ProjectThread_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadMessage" ADD CONSTRAINT "ThreadMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ProjectThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreadMessage" ADD CONSTRAINT "ThreadMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationComplaint" ADD CONSTRAINT "ModerationComplaint_complainantId_fkey" FOREIGN KEY ("complainantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationComplaint" ADD CONSTRAINT "ModerationComplaint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationComplaint" ADD CONSTRAINT "ModerationComplaint_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ProjectThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationComplaint" ADD CONSTRAINT "ModerationComplaint_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationDecision" ADD CONSTRAINT "ModerationDecision_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "ModerationComplaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModerationDecision" ADD CONSTRAINT "ModerationDecision_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpactRecord" ADD CONSTRAINT "ImpactRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpactRecord" ADD CONSTRAINT "ImpactRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImpactRecord" ADD CONSTRAINT "ImpactRecord_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ImpactRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
