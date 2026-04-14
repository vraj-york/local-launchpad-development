-- Client-link chat: public S3 URLs for attached images (references and/or replacement flow).
-- Idempotent for UAT / deploy retries.
ALTER TABLE "ChatHistory" ADD COLUMN IF NOT EXISTS "attachmentImageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
