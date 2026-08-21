-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN "stripeScheduleEndBehavior" TEXT;
