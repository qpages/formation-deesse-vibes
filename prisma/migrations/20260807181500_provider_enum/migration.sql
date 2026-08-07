-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('stripe', 'yousign');

-- AlterTable
ALTER TABLE "provider_events" ALTER COLUMN "provider" TYPE "Provider" USING ("provider"::"Provider");
