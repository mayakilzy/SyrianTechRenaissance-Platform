-- ============================================================
-- G06 — Moderation Corrections (per MASTER's FINAL MODERATION CORRECTION)
-- Migration: 20261019030000_g06_moderation_corrections
-- ============================================================
-- Two functional fixes:
--   1. USER_SUSPENDED → complaint status = RESOLVED_SUSPENDED (not ESCALATED)
--      Resolves governance record contradiction: account is suspended but
--      complaint appeared "escalated/pending" in the open queue.
--   2. CONTENT_REMOVED → actual visibility enforcement via ThreadMessage.removedAt
--      Original text preserved for authorized auditors (admin/moderator);
--      hidden from regular users in read paths.
--
-- Also adds:
--   - ModerationComplaint.targetMessageId (explicit message targeting for
--     CONTENT_REMOVED decisions, instead of relying on threadId alone)
-- ============================================================

-- 1. Add RESOLVED_SUSPENDED to ModerationStatus enum
-- PostgreSQL: ALTER TYPE ... ADD VALUE cannot run inside a transaction;
-- Prisma migrate handles this by running it separately.
ALTER TYPE "ModerationStatus" ADD VALUE IF NOT EXISTS 'RESOLVED_SUSPENDED';

-- 2. Add removedAt + removedById to ThreadMessage
ALTER TABLE "ThreadMessage" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "ThreadMessage" ADD COLUMN "removedById" TEXT;

-- 3. Add targetMessageId to ModerationComplaint
ALTER TABLE "ModerationComplaint" ADD COLUMN "targetMessageId" TEXT;

-- 4. Indexes for new columns
CREATE INDEX "ThreadMessage_removedAt_idx" ON "ThreadMessage"("removedAt");
CREATE INDEX "ModerationComplaint_targetMessageId_idx" ON "ModerationComplaint"("targetMessageId");

-- 5. Foreign keys
ALTER TABLE "ThreadMessage" ADD CONSTRAINT "ThreadMessage_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationComplaint" ADD CONSTRAINT "ModerationComplaint_targetMessageId_fkey" FOREIGN KEY ("targetMessageId") REFERENCES "ThreadMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
