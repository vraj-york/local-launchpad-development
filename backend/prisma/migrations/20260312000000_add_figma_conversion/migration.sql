-- CreateTable FigmaConversion (Cursor cloud agent / Figma conversion attempts).
-- Model existed in schema.prisma but had no migration — Supabase never got this table.

CREATE TABLE "public"."FigmaConversion" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "agentId" TEXT NOT NULL,
    "attemptedById" INTEGER NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptNumber" INTEGER,
    "nodeCount" INTEGER,
    "status" TEXT,
    "targetBranchName" TEXT,
    "projectVersionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FigmaConversion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."FigmaConversion" ADD CONSTRAINT "FigmaConversion_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."FigmaConversion" ADD CONSTRAINT "FigmaConversion_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "public"."Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."FigmaConversion" ADD CONSTRAINT "FigmaConversion_attemptedById_fkey"
  FOREIGN KEY ("attemptedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."FigmaConversion" ADD CONSTRAINT "FigmaConversion_projectVersionId_fkey"
  FOREIGN KEY ("projectVersionId") REFERENCES "public"."ProjectVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
