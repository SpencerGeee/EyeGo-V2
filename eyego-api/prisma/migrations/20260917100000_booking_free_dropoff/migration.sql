-- The rider's own drop-off point on a group/bus trip, chosen on the route map.
ALTER TABLE "Booking" ADD COLUMN "dropoffLat" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "dropoffLng" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "dropoffAddress" TEXT;
