-- SubscriptionStatus → miroir Stripe 1:1
-- + unpaid (officiel Stripe)
-- - completed (custom) → backfill vers canceled

CREATE TYPE "SubscriptionStatus_new" AS ENUM (
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);

ALTER TABLE "enrollments"
  ALTER COLUMN "subscriptionStatus" TYPE "SubscriptionStatus_new"
  USING (
    CASE
      WHEN "subscriptionStatus"::text = 'completed' THEN 'canceled'::"SubscriptionStatus_new"
      ELSE "subscriptionStatus"::text::"SubscriptionStatus_new"
    END
  );

DROP TYPE "SubscriptionStatus";

ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
