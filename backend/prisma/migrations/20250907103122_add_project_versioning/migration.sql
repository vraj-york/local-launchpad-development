-- CreateTable
CREATE TABLE "public"."ProjectVersion" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "zipFilePath" TEXT NOT NULL,
    "buildUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectVersion" ADD CONSTRAINT "ProjectVersion_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migrate existing data to ProjectVersion table
INSERT INTO "public"."ProjectVersion" ("projectId", "version", "zipFilePath", "buildUrl", "isActive", "uploadedBy", "createdAt", "updatedAt")
SELECT 
    "id" as "projectId",
    '1.0.0' as "version",
    "zipFilePath",
    "buildUrl",
    true as "isActive",
    "createdById" as "uploadedBy",
    "createdAt",
    "updatedAt"
FROM "public"."Project" 
WHERE "zipFilePath" IS NOT NULL AND "buildUrl" IS NOT NULL;

-- Now drop the old columns
ALTER TABLE "public"."Project" DROP COLUMN "buildUrl",
DROP COLUMN "zipFilePath";
