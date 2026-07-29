/*
  Warnings:

  - You are about to drop the column `makeWebhookSentAt` on the `enrollments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "makeWebhookSentAt";
