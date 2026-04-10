-- Instance-wide custom Cursor rules (shared across projects).

CREATE TABLE "CustomCursorRule" (
    "id" SERIAL NOT NULL,
    "folderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomCursorRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomCursorRule_folderName_key" ON "CustomCursorRule"("folderName");