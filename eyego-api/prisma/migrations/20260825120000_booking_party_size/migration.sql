-- Party size on a booking row.
--
-- An on-demand ride is ONE booking carrying N travellers (one payment, one
-- cancellation, one person to phone), while a group ride is N bookings of one
-- seat each. Counting rows was therefore right for one product and wrong for the
-- other: a rider who booked three seats showed on the driver's screen as one
-- passenger ("1/1 boarded", "1/3 passengers").
--
-- Defaults to 1, so every existing row keeps meaning exactly what it meant.
ALTER TABLE "Booking" ADD COLUMN "seats" INTEGER NOT NULL DEFAULT 1;

-- Backfill the rides already in flight. An on-demand trip has no route, exactly
-- one live booking, and `maxSeats` set to the party size the rider chose — so
-- that number is the seat count of that single row, and nothing else can be.
UPDATE "Booking" b
SET "seats" = t."maxSeats"
FROM "Trip" t
WHERE b."tripId" = t."id"
  AND t."routeId" IS NULL
  AND t."maxSeats" > 1
  AND (
    SELECT COUNT(*) FROM "Booking" x
    WHERE x."tripId" = t."id" AND x."status" <> 'CANCELLED'
  ) = 1;
