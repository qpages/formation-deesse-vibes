-- AlterEnum
CREATE TYPE "ProviderEventStatus" AS ENUM ('received', 'processed', 'ignored', 'failed');

-- AlterTable
ALTER TABLE "provider_events" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "provider_events" ALTER COLUMN "status" TYPE "ProviderEventStatus" USING ("status"::"ProviderEventStatus");
ALTER TABLE "provider_events" ALTER COLUMN "status" SET DEFAULT 'received';
