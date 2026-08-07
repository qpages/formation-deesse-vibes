-- Store Stripe invoice PDF / hosted page URLs for client & admin download.
ALTER TABLE "payments" ADD COLUMN "invoicePdfUrl" TEXT;
ALTER TABLE "payments" ADD COLUMN "hostedInvoiceUrl" TEXT;
