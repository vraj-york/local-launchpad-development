-- Source of truth for lock/active is Release.status (locked | active | draft | skip).
ALTER TABLE "Release" DROP COLUMN IF EXISTS "isLocked";
ALTER TABLE "Release" DROP COLUMN IF EXISTS "isActive";
