
ALTER TABLE "Release" ADD COLUMN "clientReviewAiSummary" TEXT,
ADD COLUMN "clientReviewAiSummaryAt" TIMESTAMP(3),
ADD COLUMN "clientReviewAiSummaryError" VARCHAR(500),
ADD COLUMN "showClientReviewSummary" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "clientReviewAiGenerationContext" TEXT;