-- CreateEnum (may already exist if a prior failed attempt created it)
DO $$ BEGIN
  CREATE TYPE "YousignSignerStatus" AS ENUM ('initiated', 'notified', 'verified', 'consent_given', 'processing', 'declined', 'signed', 'aborted', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "yousignSignerStatus" "YousignSignerStatus",
ADD COLUMN IF NOT EXISTS "signatureLinkExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "ndaNotifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "ndaLinkOpenedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "ndaSignedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "ndaDeliveryFailedAt" TIMESTAMP(3);
