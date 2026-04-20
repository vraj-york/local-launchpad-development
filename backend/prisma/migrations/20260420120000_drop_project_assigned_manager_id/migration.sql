-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_assignedManagerId_fkey";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN IF EXISTS "assignedManagerId";
