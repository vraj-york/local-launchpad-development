-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('github', 'jira_atlassian');

-- CreateTable
CREATE TABLE "UserOAuthConnection" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "githubLogin" TEXT,
    "jiraBaseUrl" TEXT,
    "atlassianAccountEmail" TEXT,
    "atlassianCloudId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOAuthConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserOAuthConnection_userId_provider_key" ON "UserOAuthConnection"("userId", "provider");
CREATE INDEX "UserOAuthConnection_userId_idx" ON "UserOAuthConnection"("userId");

ALTER TABLE "UserOAuthConnection" ADD CONSTRAINT "UserOAuthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "githubConnectionId" INTEGER;
ALTER TABLE "Project" ADD COLUMN "jiraConnectionId" INTEGER;

ALTER TABLE "Project" ADD CONSTRAINT "Project_githubConnectionId_fkey" FOREIGN KEY ("githubConnectionId") REFERENCES "UserOAuthConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "UserOAuthConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "_VersionRoadmapItems";
DROP TABLE IF EXISTS "ProjectAccess";


-- Allow multiple GitHub / Jira OAuth connections per user; optional label.
DROP INDEX IF EXISTS "UserOAuthConnection_userId_provider_key";

ALTER TABLE "UserOAuthConnection" ADD COLUMN IF NOT EXISTS "label" TEXT;

CREATE INDEX IF NOT EXISTS "UserOAuthConnection_userId_provider_idx" ON "UserOAuthConnection"("userId", "provider");
