-- Planned start
ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);

-- Consolidate planned ship date into releaseDate (prefer existing releaseDate if set)
UPDATE "Release"
SET "releaseDate" = COALESCE("releaseDate", "plannedReleaseDate")
WHERE "plannedReleaseDate" IS NOT NULL;

ALTER TABLE "Release" DROP COLUMN IF EXISTS "plannedReleaseDate";

CREATE TABLE "ReleaseChangeLog" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" INTEGER,
    "changedByEmail" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReleaseChangeLog_releaseId_createdAt_idx" ON "ReleaseChangeLog"("releaseId", "createdAt");

ALTER TABLE "ReleaseChangeLog" ADD CONSTRAINT "ReleaseChangeLog_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseChangeLog" ADD CONSTRAINT "ReleaseChangeLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
