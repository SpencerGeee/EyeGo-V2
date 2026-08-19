-- Destination mode: "I'm heading home, only send me rides going my way."
--
-- All nullable / defaulted, so this is additive and safe to apply to a live
-- table without a backfill. A driver with no destination set is unaffected by
-- the matcher's filter — see services/destination-mode.service.js.
ALTER TABLE "Driver" ADD COLUMN "destinationLat" DOUBLE PRECISION;
ALTER TABLE "Driver" ADD COLUMN "destinationLng" DOUBLE PRECISION;
ALTER TABLE "Driver" ADD COLUMN "destinationAddress" TEXT;
ALTER TABLE "Driver" ADD COLUMN "destinationExpiresAt" TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN "destinationUsesToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Driver" ADD COLUMN "destinationUsesDate" TIMESTAMP(3);
