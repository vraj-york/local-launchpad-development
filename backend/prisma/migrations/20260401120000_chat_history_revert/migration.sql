-- AlterTable
ALTER TABLE "ChatHistory" ADD COLUMN "revertedAt" TIMESTAMP(3),
ADD COLUMN "revertCommitSha" TEXT;
