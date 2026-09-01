-- The funnel.
--
-- Every event worth counting already crosses this API, so the choice was
-- between recording it here or shipping a third-party analytics SDK in both
-- apps — which would have to be declared as data sharing on the Play Data
-- Safety form and Apple's privacy labels, would add bundle weight, and would
-- upload events over mobile data the rider is paying for.
--
-- This is not "how many rides today"; Trip answers that. It is for the
-- questions whose answer is a RATE and which cannot be reconstructed after the
-- fact — what share of requests found a driver, how long matching took, who
-- cancelled. A request that never matched leaves almost no trace in Trip.

CREATE TABLE "AnalyticsEvent" (
  "id"        TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "tripId"    TEXT,
  "userId"    TEXT,
  "driverId"  TEXT,
  "reason"    TEXT,
  "elapsedMs" INTEGER,
  "meta"      TEXT,
  "at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- The funnel reads by type over a window.
CREATE INDEX "AnalyticsEvent_type_at_idx" ON "AnalyticsEvent" ("type", "at");
-- Reconstructing one trip's journey through the funnel.
CREATE INDEX "AnalyticsEvent_tripId_idx" ON "AnalyticsEvent" ("tripId");
-- The dashboard groups by day, and the retention sweep deletes by age.
CREATE INDEX "AnalyticsEvent_at_idx" ON "AnalyticsEvent" ("at");

-- NO foreign keys, deliberately. An analytics row must never block a delete of
-- the thing it describes, and must never fail an insert because a trip was
-- removed underneath it. These are identifiers, not relations.
