-- Align default with paiement unique (1 849 €). Existing rows unchanged.
ALTER TABLE "enrollments" ALTER COLUMN "amountCents" SET DEFAULT 184900;
