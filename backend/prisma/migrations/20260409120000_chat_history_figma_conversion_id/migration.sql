-- ChatHistory: optional link to FigmaConversion for client-link traceability
ALTER TABLE "ChatHistory" ADD COLUMN IF NOT EXISTS "figmaConversionId" INTEGER;

CREATE INDEX IF NOT EXISTS "ChatHistory_figmaConversionId_idx" ON "ChatHistory"("figmaConversionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChatHistory_figmaConversionId_fkey'
  ) THEN
    ALTER TABLE "ChatHistory"
      ADD CONSTRAINT "ChatHistory_figmaConversionId_fkey"
      FOREIGN KEY ("figmaConversionId") REFERENCES "FigmaConversion"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
