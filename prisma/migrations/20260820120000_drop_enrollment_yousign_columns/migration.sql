-- NDA state lives in nda_requests only; drop legacy yousign* columns on enrollments.

ALTER TABLE "enrollments" DROP CONSTRAINT IF EXISTS "enrollments_yousignRequestId_key";

ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "yousignRequestId";
ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "yousignSignerId";
ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "yousignStatus";
ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "yousignSignerStatus";
ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "yousignLastError";
ALTER TABLE "enrollments" DROP COLUMN IF EXISTS "yousignLastErrorAt";

DROP TYPE IF EXISTS "YousignRequestStatus";
DROP TYPE IF EXISTS "YousignSignerStatus";
