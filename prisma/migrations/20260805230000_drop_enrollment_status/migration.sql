DROP INDEX IF EXISTS "enrollments_status_idx";
ALTER TABLE "enrollments" DROP COLUMN "status";
DROP TYPE "EnrollmentStatus";
