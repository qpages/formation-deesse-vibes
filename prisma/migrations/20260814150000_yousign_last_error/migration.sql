-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "yousignLastError" TEXT,
ADD COLUMN IF NOT EXISTS "yousignLastErrorAt" TIMESTAMP(3);
