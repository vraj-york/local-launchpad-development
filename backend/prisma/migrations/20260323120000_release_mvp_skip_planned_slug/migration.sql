-- ReleaseStatus: skip
ALTER TYPE "ReleaseStatus" ADD VALUE 'skip';

-- Release: isMvp, plannedReleaseDate
ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "isMvp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Release" ADD COLUMN IF NOT EXISTS "plannedReleaseDate" TIMESTAMP(3);

-- Project.slug: optional column; backfill from name for rows missing slug (does not overwrite non-empty slug)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- Fill only missing slugs from display name (same idea as app: lowercase, spaces -> hyphens)
UPDATE "Project"
SET "slug" = lower(regexp_replace(btrim("name"), '\s+', '-', 'g'))
WHERE "slug" IS NULL OR btrim(COALESCE("slug", '')) = '';

-- Rare fallback: empty name edge case — use folder segment from projectPath
UPDATE "Project"
SET "slug" = regexp_replace("projectPath", '^projects/', '')
WHERE ("slug" IS NULL OR btrim("slug") = '')
  AND "projectPath" IS NOT NULL
  AND "projectPath" LIKE 'projects/%';

UPDATE "Project"
SET "slug" = 'project-' || "id"::text
WHERE "slug" IS NULL OR btrim("slug") = '';

-- Ensure uniqueness before unique index (column stays nullable for Prisma db push compatibility)
WITH ranked AS (
  SELECT id, "slug",
    ROW_NUMBER() OVER (PARTITION BY "slug" ORDER BY id) AS rk
  FROM "Project"
  WHERE "slug" IS NOT NULL
)
UPDATE "Project" p
SET "slug" = p."slug" || '-' || p."id"::text
FROM ranked r
WHERE p.id = r.id AND r.rk > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Project_slug_key" ON "Project"("slug");
