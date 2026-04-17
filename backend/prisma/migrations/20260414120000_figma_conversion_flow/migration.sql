-- FigmaConversion: migrate_frontend flow, optional target revision, consent flag.
-- Project / ProjectVersion: migrate-at-create intent and per-revision migrate acknowledgment (final column name: migrateFrontend).

-- Optional flow discriminator (e.g. migrate_frontend) for FigmaConversion rows.
ALTER TABLE "FigmaConversion" ADD COLUMN IF NOT EXISTS "flow" TEXT;

-- Optional: migrate_frontend targets an existing ProjectVersion (revision) to move its tag.
ALTER TABLE "FigmaConversion" ADD COLUMN IF NOT EXISTS "migrateTargetProjectVersionId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FigmaConversion_migrateTargetProjectVersionId_fkey'
  ) THEN
    ALTER TABLE "FigmaConversion"
      ADD CONSTRAINT "FigmaConversion_migrateTargetProjectVersionId_fkey"
      FOREIGN KEY ("migrateTargetProjectVersionId") REFERENCES "ProjectVersion"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Project: create-time "Import UI / Migrate Frontend" checkbox (legacy name importUiFromDevelopmentRepoAtCreate).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Project' AND column_name = 'importUiFromDevelopmentRepoAtCreate'
  ) THEN
    ALTER TABLE "Project" RENAME COLUMN "importUiFromDevelopmentRepoAtCreate" TO "migrateFrontend";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Project' AND column_name = 'migrateFrontend'
  ) THEN
    ALTER TABLE "Project" ADD COLUMN "migrateFrontend" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- FigmaConversion / ProjectVersion: migrate consent (legacy migrateFrontendDisclaimerAccepted).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'FigmaConversion' AND column_name = 'migrateFrontendDisclaimerAccepted'
  ) THEN
    ALTER TABLE "FigmaConversion" RENAME COLUMN "migrateFrontendDisclaimerAccepted" TO "migrateFrontend";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'FigmaConversion' AND column_name = 'migrateFrontend'
  ) THEN
    ALTER TABLE "FigmaConversion" ADD COLUMN "migrateFrontend" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ProjectVersion' AND column_name = 'migrateFrontendDisclaimerAccepted'
  ) THEN
    ALTER TABLE "ProjectVersion" RENAME COLUMN "migrateFrontendDisclaimerAccepted" TO "migrateFrontend";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ProjectVersion' AND column_name = 'migrateFrontend'
  ) THEN
    ALTER TABLE "ProjectVersion" ADD COLUMN "migrateFrontend" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
