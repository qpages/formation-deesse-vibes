-- Lot 1a: User + CollectionStatus / ContractStatus / AccessStatus + backfill
-- Mapping legacy EnrollmentStatus → 3 enums (documented below).

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('pending', 'current', 'past_due', 'paid', 'canceled', 'refunded');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('pending', 'sent', 'signed', 'expired', 'declined', 'canceled', 'error');

-- CreateEnum
CREATE TYPE "AccessStatus" AS ENUM ('not_eligible', 'pending', 'active', 'suspended', 'revoked');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "teachizyUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_teachizyUserId_key" ON "users"("teachizyUserId");

-- Backfill: 1 User per Enrollment (email)
INSERT INTO "users" ("id", "email", "firstName", "lastName", "stripeCustomerId", "createdAt", "updatedAt")
SELECT
    'usr_' || e."id",
    e."email",
    e."firstName",
    e."lastName",
    e."stripeCustomerId",
    e."createdAt",
    e."updatedAt"
FROM "enrollments" e;

-- Add new Enrollment columns (nullable userId first for backfill)
ALTER TABLE "enrollments" ADD COLUMN "userId" TEXT;
ALTER TABLE "enrollments" ADD COLUMN "collectionStatus" "CollectionStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "enrollments" ADD COLUMN "contractStatus" "ContractStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "enrollments" ADD COLUMN "accessStatus" "AccessStatus" NOT NULL DEFAULT 'not_eligible';
ALTER TABLE "enrollments" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'eur';
ALTER TABLE "enrollments" ADD COLUMN "firstPaymentPaidAt" TIMESTAMP(3);
ALTER TABLE "enrollments" ADD COLUMN "fullyPaidAt" TIMESTAMP(3);
ALTER TABLE "enrollments" ADD COLUMN "accessGrantedAt" TIMESTAMP(3);
ALTER TABLE "enrollments" ADD COLUMN "accessSuspendedAt" TIMESTAMP(3);
ALTER TABLE "enrollments" ADD COLUMN "accessRevokedAt" TIMESTAMP(3);

-- Link enrollments → users
UPDATE "enrollments" SET "userId" = 'usr_' || "id";

-- Map legacy status → orthogonal enums
-- paiement_en_attente → collection=pending, contract=pending, access=not_eligible
-- paiement_confirme   → collection=current (or paid if unique fully paid), contract=pending, access=not_eligible
-- nda_envoye          → collection=current/paid, contract=sent, access=not_eligible
-- nda_signe           → collection=current/paid, contract=signed, access=pending
-- teachizy_envoye     → collection=current/paid, contract=signed, access=active
-- rembourse           → collection=refunded, contract=unchanged mapping, access=revoked
-- acces_retire        → collection=as-is from payments later, access=revoked

UPDATE "enrollments" SET
    "collectionStatus" = CASE "status"
        WHEN 'paiement_en_attente' THEN 'pending'::"CollectionStatus"
        WHEN 'rembourse' THEN 'refunded'::"CollectionStatus"
        WHEN 'acces_retire' THEN CASE
            WHEN "installmentsPaid" >= COALESCE("installmentsTotal", 1) AND "installmentsPaid" > 0 THEN 'paid'::"CollectionStatus"
            WHEN "installmentsPaid" >= 1 THEN 'current'::"CollectionStatus"
            ELSE 'pending'::"CollectionStatus"
        END
        ELSE CASE
            WHEN "installmentsPaid" >= COALESCE("installmentsTotal", 1) AND "installmentsPaid" > 0 THEN 'paid'::"CollectionStatus"
            WHEN "installmentsPaid" >= 1 THEN 'current'::"CollectionStatus"
            ELSE 'pending'::"CollectionStatus"
        END
    END,
    "contractStatus" = CASE "status"
        WHEN 'paiement_en_attente' THEN 'pending'::"ContractStatus"
        WHEN 'paiement_confirme' THEN 'pending'::"ContractStatus"
        WHEN 'nda_envoye' THEN 'sent'::"ContractStatus"
        WHEN 'nda_signe' THEN 'signed'::"ContractStatus"
        WHEN 'teachizy_envoye' THEN 'signed'::"ContractStatus"
        WHEN 'rembourse' THEN CASE
            WHEN "yousignStatus" = 'done' THEN 'signed'::"ContractStatus"
            WHEN "yousignRequestId" IS NOT NULL THEN 'sent'::"ContractStatus"
            ELSE 'pending'::"ContractStatus"
        END
        WHEN 'acces_retire' THEN CASE
            WHEN "yousignStatus" = 'done' THEN 'signed'::"ContractStatus"
            WHEN "yousignRequestId" IS NOT NULL THEN 'sent'::"ContractStatus"
            ELSE 'pending'::"ContractStatus"
        END
        ELSE 'pending'::"ContractStatus"
    END,
    "accessStatus" = CASE "status"
        WHEN 'teachizy_envoye' THEN 'active'::"AccessStatus"
        WHEN 'nda_signe' THEN 'pending'::"AccessStatus"
        WHEN 'rembourse' THEN 'revoked'::"AccessStatus"
        WHEN 'acces_retire' THEN 'revoked'::"AccessStatus"
        ELSE 'not_eligible'::"AccessStatus"
    END,
    "accessGrantedAt" = CASE WHEN "status" = 'teachizy_envoye' THEN COALESCE("teachizyInvitedAt", "updatedAt") ELSE NULL END,
    "accessRevokedAt" = CASE WHEN "status" IN ('rembourse', 'acces_retire') THEN "updatedAt" ELSE NULL END,
    "firstPaymentPaidAt" = CASE WHEN "installmentsPaid" >= 1 THEN "updatedAt" ELSE NULL END,
    "fullyPaidAt" = CASE
        WHEN "installmentsPaid" >= COALESCE("installmentsTotal", 1) AND "installmentsPaid" > 0 THEN "updatedAt"
        ELSE NULL
    END;

-- Tighten userId
ALTER TABLE "enrollments" ALTER COLUMN "userId" SET NOT NULL;

-- Drop PII columns from enrollments (moved to users)
DROP INDEX IF EXISTS "enrollments_email_key";
ALTER TABLE "enrollments" DROP COLUMN "email";
ALTER TABLE "enrollments" DROP COLUMN "firstName";
ALTER TABLE "enrollments" DROP COLUMN "lastName";
ALTER TABLE "enrollments" DROP COLUMN "stripeCustomerId";

-- Foreign keys + indexes
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "enrollments_userId_idx" ON "enrollments"("userId");
CREATE INDEX "enrollments_collectionStatus_idx" ON "enrollments"("collectionStatus");
CREATE INDEX "enrollments_contractStatus_idx" ON "enrollments"("contractStatus");
CREATE INDEX "enrollments_accessStatus_idx" ON "enrollments"("accessStatus");
