-- Bitbucket Cloud OAuth + project SCM link (alternative to GitHub).

DO $$ BEGIN
  ALTER TYPE "OAuthProvider" ADD VALUE 'bitbucket';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "UserOAuthConnection" ADD COLUMN IF NOT EXISTS "bitbucketUuid" TEXT;
ALTER TABLE "UserOAuthConnection" ADD COLUMN IF NOT EXISTS "bitbucketUsername" TEXT;

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "bitbucketConnectionId" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "bitbucketUsername" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "bitbucketToken" TEXT;
-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "developerRepoUrl" TEXT;
ALTER TABLE "FigmaConversion" ADD COLUMN IF NOT EXISTS "skipLaunchpadAutomation" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Project_bitbucketConnectionId_fkey'
  ) THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_bitbucketConnectionId_fkey"
      FOREIGN KEY ("bitbucketConnectionId") REFERENCES "UserOAuthConnection"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
