-- Client link: release note on Release; ensure legacy clientGitDiffSummary is removed if present.
ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "clientReleaseNote" TEXT;
ALTER TABLE "Release" DROP COLUMN IF EXISTS "clientGitDiffSummary";
