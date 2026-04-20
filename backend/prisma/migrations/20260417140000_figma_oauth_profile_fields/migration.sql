ALTER TABLE "UserOAuthConnection" ADD COLUMN IF NOT EXISTS "figmaHandle" TEXT;
ALTER TABLE "UserOAuthConnection" ADD COLUMN IF NOT EXISTS "figmaEmail" TEXT;
