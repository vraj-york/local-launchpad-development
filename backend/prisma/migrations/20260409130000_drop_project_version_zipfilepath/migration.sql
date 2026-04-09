-- Drop legacy column; checkout/activate use gitTag only.
ALTER TABLE "ProjectVersion" DROP COLUMN IF EXISTS "zipFilePath";

-- Remove project roadmaps / roadmap items (feature retired).
DROP TABLE IF EXISTS "RoadmapItem" CASCADE;
DROP TABLE IF EXISTS "Roadmap" CASCADE;

DROP TYPE IF EXISTS "RoadmapItemPriority";
DROP TYPE IF EXISTS "RoadmapItemStatus";
DROP TYPE IF EXISTS "RoadmapItemType";
DROP TYPE IF EXISTS "TshirtSize";
DROP TYPE IF EXISTS "RoadmapStatus";
