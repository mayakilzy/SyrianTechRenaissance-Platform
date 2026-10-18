-- ============================================================
-- G06-A — Organizations, Partnerships, and Contribution Rights
-- Migration: 20261019000000_g06a_organizations_partnerships_rights
-- ============================================================
-- Adds:
--   Organization, OrganizationRepresentative
--   PartnershipRequest, PartnershipDecision, AgreementReference
--   ContributionRightsDeclaration
--   4 new enums: OrganizationStatus, PartnershipStatus,
--                PartnershipDecisionAction, RightsDeclarationType
--
-- Architectural constraints enforced:
--   * Representative cannot self-verify (service-layer check)
--   * Agreement files default to PENDING scan (fail-closed; reuses FileScanStatus)
--   * Rights declarations are evidence, NOT IP transfer (schema-level comment)
--   * No system-generated legally-binding contracts (no template field)
--   * All decisions are audit-logged via PartnershipDecision rows
-- ============================================================

-- ------------------------------------------------------------
-- 1. CREATE TYPE: new enums
-- ------------------------------------------------------------

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PartnershipStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PartnershipDecisionAction" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_REVISION');

-- CreateEnum
CREATE TYPE "RightsDeclarationType" AS ENUM ('LICENSE_GRANTED', 'ATTRIBUTION_ONLY', 'WORK_FOR_HIRE', 'OTHER');

-- ------------------------------------------------------------
-- 2. CREATE TABLE: Organization + Representative
-- ------------------------------------------------------------

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "website" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationRepresentative" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "delegatedAuthorityScope" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationRepresentative_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------
-- 3. CREATE TABLE: Partnership + Decision + Agreement
-- ------------------------------------------------------------

-- CreateTable
CREATE TABLE "PartnershipRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "proposalText" TEXT NOT NULL,
    "status" "PartnershipStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "agreementSuspendedAt" TIMESTAMP(3),
    "agreementSuspendReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnershipRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnershipDecision" (
    "id" TEXT NOT NULL,
    "partnershipRequestId" TEXT NOT NULL,
    "deciderId" TEXT NOT NULL,
    "action" "PartnershipDecisionAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementReference" (
    "id" TEXT NOT NULL,
    "partnershipRequestId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMP(3),
    "scanError" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementReference_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------
-- 4. CREATE TABLE: ContributionRightsDeclaration
-- ------------------------------------------------------------

-- CreateTable
CREATE TABLE "ContributionRightsDeclaration" (
    "id" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "declaredById" TEXT NOT NULL,
    "declarationType" "RightsDeclarationType" NOT NULL,
    "declarationText" TEXT NOT NULL,
    "evidenceStorageKey" TEXT,
    "evidenceScanStatus" "FileScanStatus",
    "evidenceScannedAt" TIMESTAMP(3),
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "ContributionRightsDeclaration_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------------
-- 5. CREATE INDEX
-- ------------------------------------------------------------

-- Organization indexes
CREATE INDEX "Organization_status_idx" ON "Organization"("status");
CREATE INDEX "Organization_email_idx" ON "Organization"("email");

-- OrganizationRepresentative indexes
CREATE UNIQUE INDEX "OrganizationRepresentative_organizationId_userId_key" ON "OrganizationRepresentative"("organizationId", "userId");
CREATE INDEX "OrganizationRepresentative_organizationId_idx" ON "OrganizationRepresentative"("organizationId");
CREATE INDEX "OrganizationRepresentative_userId_idx" ON "OrganizationRepresentative"("userId");
CREATE INDEX "OrganizationRepresentative_verifiedAt_idx" ON "OrganizationRepresentative"("verifiedAt");

-- PartnershipRequest indexes
CREATE INDEX "PartnershipRequest_organizationId_idx" ON "PartnershipRequest"("organizationId");
CREATE INDEX "PartnershipRequest_projectId_idx" ON "PartnershipRequest"("projectId");
CREATE INDEX "PartnershipRequest_status_idx" ON "PartnershipRequest"("status");
CREATE INDEX "PartnershipRequest_requesterId_idx" ON "PartnershipRequest"("requesterId");

-- PartnershipDecision indexes
CREATE INDEX "PartnershipDecision_partnershipRequestId_idx" ON "PartnershipDecision"("partnershipRequestId");
CREATE INDEX "PartnershipDecision_deciderId_idx" ON "PartnershipDecision"("deciderId");

-- AgreementReference indexes
CREATE UNIQUE INDEX "AgreementReference_partnershipRequestId_key" ON "AgreementReference"("partnershipRequestId");
CREATE INDEX "AgreementReference_scanStatus_idx" ON "AgreementReference"("scanStatus");

-- ContributionRightsDeclaration indexes
CREATE UNIQUE INDEX "ContributionRightsDeclaration_contributionId_key" ON "ContributionRightsDeclaration"("contributionId");
CREATE INDEX "ContributionRightsDeclaration_declaredById_idx" ON "ContributionRightsDeclaration"("declaredById");
CREATE INDEX "ContributionRightsDeclaration_declarationType_idx" ON "ContributionRightsDeclaration"("declarationType");

-- ------------------------------------------------------------
-- 6. ADD FOREIGN KEY CONSTRAINTS
-- ------------------------------------------------------------

-- Organization FKs (verifiedById is nullable — SET NULL on delete)
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OrganizationRepresentative FKs
ALTER TABLE "OrganizationRepresentative" ADD CONSTRAINT "OrganizationRepresentative_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationRepresentative" ADD CONSTRAINT "OrganizationRepresentative_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationRepresentative" ADD CONSTRAINT "OrganizationRepresentative_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PartnershipRequest FKs
ALTER TABLE "PartnershipRequest" ADD CONSTRAINT "PartnershipRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnershipRequest" ADD CONSTRAINT "PartnershipRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnershipRequest" ADD CONSTRAINT "PartnershipRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PartnershipDecision FKs
ALTER TABLE "PartnershipDecision" ADD CONSTRAINT "PartnershipDecision_partnershipRequestId_fkey" FOREIGN KEY ("partnershipRequestId") REFERENCES "PartnershipRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnershipDecision" ADD CONSTRAINT "PartnershipDecision_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgreementReference FKs
ALTER TABLE "AgreementReference" ADD CONSTRAINT "AgreementReference_partnershipRequestId_fkey" FOREIGN KEY ("partnershipRequestId") REFERENCES "PartnershipRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgreementReference" ADD CONSTRAINT "AgreementReference_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ContributionRightsDeclaration FKs
ALTER TABLE "ContributionRightsDeclaration" ADD CONSTRAINT "ContributionRightsDeclaration_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "ContributionReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionRightsDeclaration" ADD CONSTRAINT "ContributionRightsDeclaration_declaredById_fkey" FOREIGN KEY ("declaredById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionRightsDeclaration" ADD CONSTRAINT "ContributionRightsDeclaration_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
