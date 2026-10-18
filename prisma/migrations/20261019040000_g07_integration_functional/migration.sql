-- ============================================================
-- G07 — Integration Core Functional Vertical Slice
-- Migration: 20261019040000_g07_integration_functional
-- ============================================================
-- Extends the G01 Integration Core scaffold with functional fields:
--   - Provider: approval workflow + mock labeling
--   - Connection: webhook signing secret + suspend lifecycle
--   - Job: worker claim + timeout + cancellation
-- ============================================================

-- 1. IntegrationProvider: approval + mock fields
ALTER TABLE "IntegrationProvider" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "IntegrationProvider" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationProvider" ADD COLUMN "isMock" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "IntegrationProvider_isMock_idx" ON "IntegrationProvider"("isMock");

-- 2. IntegrationConnection: webhook secret + suspend fields
ALTER TABLE "IntegrationConnection" ADD COLUMN "revokedReason" TEXT;
ALTER TABLE "IntegrationConnection" ADD COLUMN "webhookSecretHash" TEXT;
ALTER TABLE "IntegrationConnection" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationConnection" ADD COLUMN "suspendedReason" TEXT;

CREATE INDEX "IntegrationConnection_status_idx" ON "IntegrationConnection"("status");

-- 3. IntegrationJob: worker claim + timeout + cancellation fields
ALTER TABLE "IntegrationJob" ADD COLUMN "claimedBy" TEXT;
ALTER TABLE "IntegrationJob" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationJob" ADD COLUMN "timeoutMs" INTEGER NOT NULL DEFAULT 30000;
ALTER TABLE "IntegrationJob" ADD COLUMN "timeoutAt" TIMESTAMP(3);
ALTER TABLE "IntegrationJob" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "IntegrationJob" ADD COLUMN "cancelledById" TEXT;

CREATE INDEX "IntegrationJob_claimedBy_claimedAt_idx" ON "IntegrationJob"("claimedBy", "claimedAt");
CREATE INDEX "IntegrationJob_status_claimedAt_idx" ON "IntegrationJob"("status", "claimedAt");

-- 4. FK for approvedById (references User, SET NULL on delete)
ALTER TABLE "IntegrationProvider" ADD CONSTRAINT "IntegrationProvider_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. FK for cancelledById (references User, SET NULL on delete)
ALTER TABLE "IntegrationJob" ADD CONSTRAINT "IntegrationJob_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Drop the subjectId FK to User (polymorphic — subjectKind determines the table)
ALTER TABLE "IntegrationConnection" DROP CONSTRAINT IF EXISTS "IntegrationConnection_subjectId_fkey";
