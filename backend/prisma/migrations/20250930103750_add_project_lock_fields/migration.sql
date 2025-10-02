/*
  Warnings:

  - A unique constraint covering the columns `[lockToken]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Project" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_lockToken_key" ON "public"."Project"("lockToken");
