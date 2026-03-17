-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('draft', 'active', 'locked');

-- AlterTable: add status column as enum with default
ALTER TABLE "public"."Release" ADD COLUMN IF NOT EXISTS "status" "ReleaseStatus" NOT NULL DEFAULT 'draft';

-- Backfill existing rows: locked -> locked; active (and not locked) -> active; else draft
UPDATE "public"."Release"
SET "status" = CASE
  WHEN "isLocked" = true THEN 'locked'::"ReleaseStatus"
  WHEN "isActive" = true THEN 'active'::"ReleaseStatus"
  ELSE 'draft'::"ReleaseStatus"
END;
