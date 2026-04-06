-- ChatHistory: revert metadata, isActiveChat + index, drop legacy tone/msgKey
-- Release: actual ship date + notes

-- AlterTable
ALTER TABLE "ChatHistory" ADD COLUMN "revertedAt" TIMESTAMP(3),
ADD COLUMN "revertCommitSha" TEXT;

-- AlterTable
ALTER TABLE "ChatHistory" ADD COLUMN "isActiveChat" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "ChatHistory_projectId_releaseId_isActiveChat_idx" ON "ChatHistory"("projectId", "releaseId", "isActiveChat");

-- AlterTable
ALTER TABLE "ChatHistory" DROP COLUMN IF EXISTS "tone",
DROP COLUMN IF EXISTS "msgKey";

-- AlterTable
ALTER TABLE "Release" ADD COLUMN "actualReleaseDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Release" ADD COLUMN "actualReleaseNotes" TEXT;

