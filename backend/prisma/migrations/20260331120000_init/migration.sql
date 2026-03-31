-- Squashed migration: full schema as of schema.prisma (replaces prior incremental migrations).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('draft', 'active', 'locked', 'skip');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'manager');

-- CreateEnum
CREATE TYPE "RoadmapStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TshirtSize" AS ENUM ('XS', 'S', 'M', 'L', 'XL');

-- CreateEnum
CREATE TYPE "RoadmapItemType" AS ENUM ('FEATURE', 'EPIC', 'INITIATIVE', 'TECH_DEBT', 'BUG', 'IMPROVEMENT');

-- CreateEnum
CREATE TYPE "RoadmapItemStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'DRAFT', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RoadmapItemPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "createdById" INTEGER NOT NULL,
    "assignedManagerId" INTEGER NOT NULL,
    "isUploading" BOOLEAN NOT NULL DEFAULT false,
    "githubUsername" TEXT,
    "githubToken" TEXT,
    "jiraBaseUrl" TEXT,
    "jiraProjectKey" TEXT,
    "jiraApiToken" TEXT,
    "jiraUsername" TEXT,
    "jiraIssueType" TEXT,
    "port" INTEGER,
    "projectPath" TEXT,
    "gitRepoPath" TEXT,
    "nginxConfigPath" TEXT,
    "projectId" TEXT,
    "assignedUserEmails" TEXT,
    "stakeholderEmails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAccess" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "releaseId" INTEGER,
    "version" TEXT NOT NULL,
    "zipFilePath" TEXT,
    "gitTag" TEXT NOT NULL,
    "buildUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "releaseDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "status" "ReleaseStatus" NOT NULL DEFAULT 'draft',
    "isMvp" BOOLEAN NOT NULL DEFAULT false,
    "lockedBy" TEXT,
    "clientReleaseNote" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseChangeLog" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" INTEGER,
    "changedByEmail" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FigmaConversion" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "agentId" TEXT NOT NULL,
    "attemptedById" INTEGER NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptNumber" INTEGER,
    "nodeCount" INTEGER,
    "status" TEXT,
    "targetBranchName" TEXT,
    "projectVersionId" INTEGER,
    "pendingClientChatMessageId" INTEGER,
    "deferLaunchpadMerge" BOOLEAN NOT NULL DEFAULT false,
    "awaitingLaunchpadConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FigmaConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatHistory" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "tone" TEXT,
    "text" TEXT NOT NULL,
    "msgKey" TEXT,
    "appliedCommitSha" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roadmap" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RoadmapStatus" NOT NULL DEFAULT 'DRAFT',
    "tshirtSize" "TshirtSize" NOT NULL DEFAULT 'M',
    "timelineStart" TIMESTAMP(3) NOT NULL,
    "timelineEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Roadmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapItem" (
    "id" SERIAL NOT NULL,
    "roadmapId" INTEGER NOT NULL,
    "releaseId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "RoadmapItemType" NOT NULL DEFAULT 'FEATURE',
    "status" "RoadmapItemStatus" NOT NULL DEFAULT 'PLANNED',
    "priority" "RoadmapItemPriority" NOT NULL DEFAULT 'MEDIUM',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoadmapItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_VersionRoadmapItems" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_VersionRoadmapItems_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_port_key" ON "Project"("port");

-- CreateIndex
CREATE INDEX "ReleaseChangeLog_releaseId_createdAt_idx" ON "ReleaseChangeLog"("releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatHistory_projectId_releaseId_createdAt_idx" ON "ChatHistory"("projectId", "releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatHistory_projectId_releaseId_appliedCommitSha_idx" ON "ChatHistory"("projectId", "releaseId", "appliedCommitSha");

-- CreateIndex
CREATE INDEX "_VersionRoadmapItems_B_index" ON "_VersionRoadmapItems"("B");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseChangeLog" ADD CONSTRAINT "ReleaseChangeLog_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseChangeLog" ADD CONSTRAINT "ReleaseChangeLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FigmaConversion" ADD CONSTRAINT "FigmaConversion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FigmaConversion" ADD CONSTRAINT "FigmaConversion_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FigmaConversion" ADD CONSTRAINT "FigmaConversion_attemptedById_fkey" FOREIGN KEY ("attemptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FigmaConversion" ADD CONSTRAINT "FigmaConversion_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "ProjectVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatHistory" ADD CONSTRAINT "ChatHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatHistory" ADD CONSTRAINT "ChatHistory_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roadmap" ADD CONSTRAINT "Roadmap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadmapItem" ADD CONSTRAINT "RoadmapItem_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "Roadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VersionRoadmapItems" ADD CONSTRAINT "_VersionRoadmapItems_A_fkey" FOREIGN KEY ("A") REFERENCES "ProjectVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VersionRoadmapItems" ADD CONSTRAINT "_VersionRoadmapItems_B_fkey" FOREIGN KEY ("B") REFERENCES "RoadmapItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
