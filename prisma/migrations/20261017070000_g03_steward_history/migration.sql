-- G03-FINAL: Steward assignment history (audit trail)
--
-- The original G03 migration created StewardAssignment with projectId @unique,
-- which prevented keeping a history of steward assignments. This migration:
--   1. Drops the old unique constraint on projectId
--   2. Creates a partial unique index: one active steward per project
--      (WHERE unassignedAt IS NULL)
-- This allows multiple steward assignment rows per project (audit trail)
-- while still enforcing exactly one active steward.

-- Drop the old unique constraint (auto-generated name by Prisma).
DROP INDEX IF EXISTS "StewardAssignment_projectId_key";

-- Create partial unique index: only one active steward per project.
CREATE UNIQUE INDEX "StewardAssignment_projectId_active_unique"
  ON "StewardAssignment"("projectId")
  WHERE "unassignedAt" IS NULL;
