-- Add gitTag alongside zipFilePath (keeps zipFilePath to avoid data loss).
ALTER TABLE "ProjectVersion" ADD COLUMN IF NOT EXISTS "gitTag" TEXT;

-- Backfill from legacy column where gitTag is still null
UPDATE "ProjectVersion"
SET "gitTag" = "zipFilePath"
WHERE "gitTag" IS NULL AND "zipFilePath" IS NOT NULL;

-- Enforce NOT NULL only when every row has gitTag (Prisma schema expects NOT NULL)
-- If any row has both null, this will fail — fix data then re-run migrate deploy.
ALTER TABLE "ProjectVersion" ALTER COLUMN "gitTag" SET NOT NULL;
