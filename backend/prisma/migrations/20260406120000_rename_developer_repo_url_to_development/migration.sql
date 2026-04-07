-- Rename column to match Prisma field developmentRepoUrl (idempotent if already renamed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Project' AND column_name = 'developerRepoUrl'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Project' AND column_name = 'developmentRepoUrl'
  ) THEN
    ALTER TABLE "Project" RENAME COLUMN "developerRepoUrl" TO "developmentRepoUrl";
  END IF;
END $$;
