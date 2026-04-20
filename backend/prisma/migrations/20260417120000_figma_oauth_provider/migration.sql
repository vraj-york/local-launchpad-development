-- Figma REST API OAuth as UserOAuthConnection (Launchpad integrations).
ALTER TYPE "OAuthProvider" ADD VALUE 'figma';

ALTER TABLE "UserOAuthConnection" ADD COLUMN IF NOT EXISTS "figmaUserId" TEXT;

CREATE INDEX IF NOT EXISTS "UserOAuthConnection_userId_figmaUserId_idx"
  ON "UserOAuthConnection"("userId", "figmaUserId");
