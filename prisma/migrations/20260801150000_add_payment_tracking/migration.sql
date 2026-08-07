-- CreateEnum
CREATE TYPE "PaymentPlanId" AS ENUM ('unique', 'x2', 'x4', 'x6');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('paid', 'open', 'failed', 'void', 'uncollectible', 'draft');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM (
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'paused',
  'completed'
);

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN "stripeSubscriptionId" TEXT,
ADD COLUMN "stripeScheduleId" TEXT,
ADD COLUMN "paymentPlan" "PaymentPlanId",
ADD COLUMN "installmentsTotal" INTEGER,
ADD COLUMN "installmentsPaid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalAmountCents" INTEGER,
ADD COLUMN "collectedAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextInstallmentDueAt" TIMESTAMP(3),
ADD COLUMN "subscriptionStatus" "SubscriptionStatus";

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_stripeSubscriptionId_key" ON "enrollments"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_stripeScheduleId_key" ON "enrollments"("stripeScheduleId");

-- CreateIndex
CREATE INDEX "enrollments_subscriptionStatus_idx" ON "enrollments"("subscriptionStatus");

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "stripePaymentIntentId" TEXT,
    "installmentNumber" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "status" "PaymentStatus" NOT NULL,
    "failureReason" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripeInvoiceId_key" ON "payments"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_enrollmentId_installmentNumber_key" ON "payments"("enrollmentId", "installmentNumber");

-- CreateIndex
CREATE INDEX "payments_enrollmentId_idx" ON "payments"("enrollmentId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_dueAt_idx" ON "payments"("dueAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
