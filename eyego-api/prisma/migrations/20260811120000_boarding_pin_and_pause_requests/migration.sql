-- "Verify My Ride" + "Pause requests".
--
-- All three columns are additive and nullable-or-defaulted, so this is safe to
-- apply to a live database with traffic on it: existing rows get the defaults,
-- and every read path treats NULL/false as "feature off", which is the
-- behaviour those rows already had.

-- The 4-digit code a rider shows their driver before boarding, and the moment
-- the driver entered it correctly. NULL pin = this rider never opted in, and
-- boarding is ungated exactly as before.
ALTER TABLE "Booking" ADD COLUMN "boardingPin" TEXT;
ALTER TABLE "Booking" ADD COLUMN "pinVerifiedAt" TIMESTAMP(3);

-- Opt-in, because a safety step nobody chose is a safety step people learn to
-- skip. Existing riders are unaffected.
ALTER TABLE "User" ADD COLUMN "requireBoardingPin" BOOLEAN NOT NULL DEFAULT false;

-- Stop back-to-back offers without going offline. Defaults to false so every
-- existing driver stays exactly as available as they are today.
ALTER TABLE "Driver" ADD COLUMN "requestsPaused" BOOLEAN NOT NULL DEFAULT false;

-- Dispatch filters on (status, isOnline, requestsPaused) on every candidate
-- lookup; without this the new column turns those into a wider scan as the
-- driver table grows.
CREATE INDEX "Driver_isOnline_requestsPaused_idx" ON "Driver"("isOnline", "requestsPaused");
