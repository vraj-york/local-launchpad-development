-- AlterTable
ALTER TABLE "ChatHistory" ADD COLUMN "isActiveChat" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "ChatHistory_projectId_releaseId_isActiveChat_idx" ON "ChatHistory"("projectId", "releaseId", "isActiveChat");
