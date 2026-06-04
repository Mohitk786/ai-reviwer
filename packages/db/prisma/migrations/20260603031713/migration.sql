/*
  Warnings:

  - You are about to drop the column `dismissed` on the `AiReviewComment` table. All the data in the column will be lost.
  - You are about to drop the column `dismissedAt` on the `AiReviewComment` table. All the data in the column will be lost.
  - You are about to drop the column `dismissedById` on the `AiReviewComment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AiReviewComment" DROP COLUMN "dismissed",
DROP COLUMN "dismissedAt",
DROP COLUMN "dismissedById";
