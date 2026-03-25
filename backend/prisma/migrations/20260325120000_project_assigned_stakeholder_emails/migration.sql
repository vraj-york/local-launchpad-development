-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "assignedUserEmails" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "stakeholderEmails" TEXT;
