-- ─────────────────────────────────────────────────────────────────────────────
-- SAVED PLACE SLOTS + MAP REPORTS
--
-- Two features that happen to land together; neither depends on the other.
--
-- 1. `SavedPlace.slot` turns Home and Work from something INFERRED off the label
--    into something the rider chooses. The old rule was
--    `label.toLowerCase().includes('home')`, applied in two places, and it made
--    the two halves of the feature fight: naming a place the way a person
--    actually would ("Mum's home") claimed the Home shortcut and overwrote the
--    address already in it.
--
--    The backfill below reproduces the OLD inference exactly once, so every row
--    written under the old rule keeps the meaning it had. It is deliberately
--    written to take the OLDEST claimant per user — that is which row the apps'
--    `find()` would have resolved to — so nobody's Home shortcut moves.
--
-- 2. `MapReport` is the "Improve maps" inbox. See the model comment in
--    schema.prisma for why it is one table with a payload blob.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── SavedPlace ───────────────────────────────────────────────────────────────
ALTER TABLE "SavedPlace" ADD COLUMN "slot" TEXT;
ALTER TABLE "SavedPlace" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SavedPlace" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill HOME: the oldest row per user whose label claims it.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" ASC) AS rn
  FROM "SavedPlace"
  WHERE LOWER("label") LIKE '%home%'
)
UPDATE "SavedPlace" sp
SET "slot" = 'HOME'
FROM ranked
WHERE sp."id" = ranked."id" AND ranked.rn = 1;

-- Backfill WORK the same way, skipping anything already claimed as HOME (a row
-- labelled "home office" claims both under the old rule; HOME wins, which is
-- the order `slotOf` checked them in).
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" ASC) AS rn
  FROM "SavedPlace"
  WHERE "slot" IS NULL
    AND (LOWER("label") LIKE '%work%' OR LOWER("label") LIKE '%office%')
)
UPDATE "SavedPlace" sp
SET "slot" = 'WORK'
FROM ranked
WHERE sp."id" = ranked."id" AND ranked.rn = 1;

-- Order the rest by the order they were created, so the screen does not
-- reshuffle on first load.
UPDATE "SavedPlace" sp
SET "sortOrder" = seq.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" ASC) AS rn
  FROM "SavedPlace"
) seq
WHERE sp."id" = seq."id";

-- One Home and one Work per rider, enforced here rather than by whichever code
-- path wrote last. NULLs are unconstrained in Postgres, so free-form places are
-- unaffected and there may be any number of them.
CREATE UNIQUE INDEX "SavedPlace_userId_slot_key" ON "SavedPlace"("userId", "slot");

-- ── MapReport ────────────────────────────────────────────────────────────────
CREATE TABLE "MapReport" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "note" TEXT,
    "payload" JSONB,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "driverId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MapReport_status_createdAt_idx" ON "MapReport"("status", "createdAt");
CREATE INDEX "MapReport_userId_createdAt_idx" ON "MapReport"("userId", "createdAt");
CREATE INDEX "MapReport_type_status_idx" ON "MapReport"("type", "status");
CREATE INDEX "MapReport_lat_lng_idx" ON "MapReport"("lat", "lng");

-- SetNull, not Cascade: a deleted account must not take the street correction
-- with it. The road is still wrong.
ALTER TABLE "MapReport"
  ADD CONSTRAINT "MapReport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
