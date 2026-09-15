-- Where the rider gets OFF.
--
-- `pickupStopId` has recorded where a rider boards mid-route since the
-- canonical-trip migration; this is its mirror, so a rider can alight at an
-- on-route stop and be charged for the road actually ridden. Nullable: an
-- absent value means "rides to the route's destination", which is what every
-- existing row already meant.
--
-- The schema change shipped in 7d558c3 without this file, so every generated
-- client selected a column the database did not have: every read or write of
-- a Booking row 500'd at once (ride request, active trip, trip detail,
-- payment init).
ALTER TABLE "Booking" ADD COLUMN "dropoffStopId" TEXT;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_dropoffStopId_fkey"
  FOREIGN KEY ("dropoffStopId") REFERENCES "VirtualStop"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
