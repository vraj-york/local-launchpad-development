-- Optional per-release submodule path and Cursor agent ref (set when release is locked).
ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "developerSubmodulePath" TEXT;
ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "developerAgentRef" TEXT;
