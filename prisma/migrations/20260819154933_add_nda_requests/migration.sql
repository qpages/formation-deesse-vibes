-- CreateEnum
CREATE TYPE "SignatureProvider" AS ENUM ('yousign');

-- CreateEnum
CREATE TYPE "SignKind" AS ENUM ('redirect', 'embed');

-- CreateTable
CREATE TABLE "nda_requests" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "provider" "SignatureProvider" NOT NULL,
    "externalRequestId" TEXT NOT NULL,
    "externalSignerId" TEXT,
    "signKind" "SignKind" NOT NULL DEFAULT 'redirect',
    "providerStatus" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nda_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nda_requests_enrollmentId_key" ON "nda_requests"("enrollmentId");

-- CreateIndex
CREATE INDEX "nda_requests_enrollmentId_idx" ON "nda_requests"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "nda_requests_provider_externalRequestId_key" ON "nda_requests"("provider", "externalRequestId");

-- AddForeignKey
ALTER TABLE "nda_requests" ADD CONSTRAINT "nda_requests_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing enrollment yousign* columns (expand-contract).
INSERT INTO "nda_requests" (
    "id",
    "enrollmentId",
    "provider",
    "externalRequestId",
    "externalSignerId",
    "signKind",
    "lastError",
    "lastErrorAt",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    'yousign'::"SignatureProvider",
    "yousignRequestId",
    "yousignSignerId",
    'redirect'::"SignKind",
    "yousignLastError",
    "yousignLastErrorAt",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "enrollments"
WHERE "yousignRequestId" IS NOT NULL;
