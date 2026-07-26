-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM (
  'paiement_en_attente',
  'paiement_confirme',
  'nda_envoye',
  'nda_signe',
  'invitation_envoyee',
  'rembourse',
  'acces_retire'
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'paiement_en_attente',
    "consentCgvAt" TIMESTAMP(3),
    "consentNdaAt" TIMESTAMP(3),
    "consentPrivacyAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 32000,
    "yousignRequestId" TEXT,
    "yousignSignerId" TEXT,
    "ndaResendCount" INTEGER NOT NULL DEFAULT 0,
    "ndaResendDay" TIMESTAMP(3),
    "ndaLastResendAt" TIMESTAMP(3),
    "makeWebhookSentAt" TIMESTAMP(3),
    "teachizyInvitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "payloadCipherText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_email_key" ON "enrollments"("email");
CREATE UNIQUE INDEX "enrollments_stripeCheckoutSessionId_key" ON "enrollments"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "enrollments_stripePaymentIntentId_key" ON "enrollments"("stripePaymentIntentId");
CREATE UNIQUE INDEX "enrollments_yousignRequestId_key" ON "enrollments"("yousignRequestId");
CREATE INDEX "enrollments_status_idx" ON "enrollments"("status");
CREATE INDEX "enrollments_createdAt_idx" ON "enrollments"("createdAt");

CREATE UNIQUE INDEX "processed_events_provider_eventId_key" ON "processed_events"("provider", "eventId");
CREATE INDEX "processed_events_createdAt_idx" ON "processed_events"("createdAt");
CREATE INDEX "processed_events_enrollmentId_idx" ON "processed_events"("enrollmentId");

CREATE UNIQUE INDEX "magic_links_tokenHash_key" ON "magic_links"("tokenHash");
CREATE INDEX "magic_links_enrollmentId_idx" ON "magic_links"("enrollmentId");
CREATE INDEX "magic_links_expiresAt_idx" ON "magic_links"("expiresAt");

CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

CREATE INDEX "admin_actions_enrollmentId_idx" ON "admin_actions"("enrollmentId");
CREATE INDEX "admin_actions_createdAt_idx" ON "admin_actions"("createdAt");

-- AddForeignKey
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
