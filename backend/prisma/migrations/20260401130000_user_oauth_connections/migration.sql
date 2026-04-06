-- OAuthProvider enum, UserOAuthConnection, Project FKs, drop legacy join tables.
-- Idempotent: safe if objects already exist (partial apply / drift).

DO $$ BEGIN
  CREATE TYPE "OAuthProvider" AS ENUM ('github', 'jira_atlassian');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserOAuthConnection" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "UserOAuthConnection_userId_provider_key" ON "UserOAuthConnection"("userId", "provider");
CREATE INDEX IF NOT EXISTS "UserOAuthConnection_userId_idx" ON "UserOAuthConnection"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserOAuthConnection_userId_fkey') THEN
    ALTER TABLE "UserOAuthConnection" ADD CONSTRAINT "UserOAuthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "githubConnectionId" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "jiraConnectionId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_githubConnectionId_fkey') THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_githubConnectionId_fkey" FOREIGN KEY ("githubConnectionId") REFERENCES "UserOAuthConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_jiraConnectionId_fkey') THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_jiraConnectionId_fkey" FOREIGN KEY ("jiraConnectionId") REFERENCES "UserOAuthConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DROP TABLE IF EXISTS "_VersionRoadmapItems";
DROP TABLE IF EXISTS "ProjectAccess";

-- Allow multiple GitHub / Jira OAuth connections per user; optional label.
DROP INDEX IF EXISTS "UserOAuthConnection_userId_provider_key";

ALTER TABLE "UserOAuthConnection" ADD COLUMN IF NOT EXISTS "label" TEXT;

CREATE INDEX IF NOT EXISTS "UserOAuthConnection_userId_provider_idx" ON "UserOAuthConnection"("userId", "provider");
