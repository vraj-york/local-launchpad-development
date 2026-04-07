-- ChatHistory: revert metadata, isActiveChat + index, drop legacy tone/msgKey
-- Release: actual ship date + notes
-- Idempotent: safe if columns/index already exist (e.g. partial apply or drift).

ALTER TABLE "ChatHistory" ADD COLUMN IF NOT EXISTS "revertedAt" TIMESTAMP(3);
ALTER TABLE "ChatHistory" ADD COLUMN IF NOT EXISTS "revertCommitSha" TEXT;
ALTER TABLE "ChatHistory" ADD COLUMN IF NOT EXISTS "isActiveChat" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "ChatHistory_projectId_releaseId_isActiveChat_idx" ON "ChatHistory"("projectId", "releaseId", "isActiveChat");

ALTER TABLE "ChatHistory" DROP COLUMN IF EXISTS "tone",
DROP COLUMN IF EXISTS "msgKey";

ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "actualReleaseDate" TIMESTAMP(3);
ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "actualReleaseNotes" TEXT;
