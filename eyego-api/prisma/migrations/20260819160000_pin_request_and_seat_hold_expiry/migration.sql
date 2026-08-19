-- Boarding-PIN requests survive a backgrounded rider app, and a provisional
-- seat hold has a deadline instead of living forever.
ALTER TABLE "Booking" ADD COLUMN "pinRequestedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "holdExpiresAt"  TIMESTAMP(3);

-- The sweeper looks for expired holds by deadline; without this it is a full
-- scan of every booking on every pass.
CREATE INDEX "Booking_holdExpiresAt_idx" ON "Booking"("holdExpiresAt");
