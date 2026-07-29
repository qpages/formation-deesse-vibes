-- CreateEnum
CREATE TYPE "YousignRequestStatus" AS ENUM ('ongoing', 'done', 'expired', 'declined', 'canceled', 'rejected', 'error');

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN "yousignStatus" "YousignRequestStatus";
