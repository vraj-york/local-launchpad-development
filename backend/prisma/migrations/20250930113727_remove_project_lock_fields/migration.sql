/*
  Warnings:

  - You are about to drop the column `isLocked` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `lockToken` on the `Project` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."Project_lockToken_key";

-- AlterTable
ALTER TABLE "public"."Project" DROP COLUMN "isLocked",
DROP COLUMN "lockToken";
