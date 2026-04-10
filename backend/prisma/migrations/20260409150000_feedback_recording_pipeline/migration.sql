-- CreateEnum
CREATE TYPE "FeedbackRecordingSessionStatus" AS ENUM ('uploading', 'ready_for_merge', 'merged', 'failed');

-- CreateEnum
CREATE TYPE "FeedbackRecordingMergeJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "FeedbackRecordingSession" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "reporterEmail" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "status" "FeedbackRecordingSessionStatus" NOT NULL DEFAULT 'uploading',
    "chunkCount" INTEGER,
    "finalS3Key" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackRecordingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackRecordingMergeJob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "jiraIssueKey" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "status" "FeedbackRecordingMergeJobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackRecordingMergeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackRecordingSession_projectId_createdAt_idx" ON "FeedbackRecordingSession"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackRecordingMergeJob_status_createdAt_idx" ON "FeedbackRecordingMergeJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "FeedbackRecordingSession" ADD CONSTRAINT "FeedbackRecordingSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRecordingMergeJob" ADD CONSTRAINT "FeedbackRecordingMergeJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FeedbackRecordingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
