-- Lot 2: ProcessedEvent → ProviderEvent (même table migrée)

ALTER TABLE "processed_events" RENAME TO "provider_events";

ALTER TABLE "provider_events" RENAME COLUMN "eventId" TO "providerEventId";
ALTER TABLE "provider_events" RENAME COLUMN "createdAt" TO "receivedAt";

ALTER TABLE "provider_events" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "provider_events" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'processed';
ALTER TABLE "provider_events" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "provider_events" ADD COLUMN "lastError" TEXT;

UPDATE "provider_events" SET "processedAt" = "receivedAt" WHERE "processedAt" IS NULL;

-- Indexes were auto-renamed with the table; recreate with Prisma names
DROP INDEX IF EXISTS "processed_events_provider_eventId_key";
DROP INDEX IF EXISTS "provider_events_provider_eventId_key";
DROP INDEX IF EXISTS "processed_events_createdAt_idx";
DROP INDEX IF EXISTS "provider_events_createdAt_idx";
DROP INDEX IF EXISTS "processed_events_enrollmentId_idx";
DROP INDEX IF EXISTS "provider_events_enrollmentId_idx";
DROP INDEX IF EXISTS "provider_events_receivedAt_idx";

ALTER TABLE "provider_events" RENAME CONSTRAINT "processed_events_pkey" TO "provider_events_pkey";
ALTER TABLE "provider_events" RENAME CONSTRAINT "processed_events_enrollmentId_fkey" TO "provider_events_enrollmentId_fkey";

CREATE UNIQUE INDEX "provider_events_provider_providerEventId_key" ON "provider_events"("provider", "providerEventId");
CREATE INDEX "provider_events_status_receivedAt_idx" ON "provider_events"("status", "receivedAt");
CREATE INDEX "provider_events_enrollmentId_idx" ON "provider_events"("enrollmentId");
