-- AlterTable
ALTER TABLE "Project" ADD COLUMN "fromScratch" BOOLEAN NOT NULL DEFAULT false;

-- Rows that already stored a scratch prompt were created via the from-scratch flow.
UPDATE "Project" SET "fromScratch" = true WHERE "scratchPrompt" IS NOT NULL;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "scratchAgentStatus" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "scratchVersionStatus" TEXT;
