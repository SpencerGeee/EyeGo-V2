-- THE OTHER HALF OF THE PRICE LOCK.
--
-- `baseFarePesewas` and `perKmRatePesewas` have always pinned the metered part
-- of a trip's fare at creation, so an operator retuning the rate card could not
-- reprice a ride already under way. The FEES were not pinned:
-- RIDE_BOOKING_FEE_RATE and RIDE_PLATFORM_FEE_PESEWAS were read live from
-- PlatformSetting on every calculation, so changing one repriced every trip in
-- flight — and any path that re-derives a fare afterwards (a receipt, a
-- dispute, an earnings breakdown) would then disagree with the ledger row that
-- was actually charged, with no way to tell which number was wrong.
--
-- Deliberately NULLable with no backfill. A null means "this trip has no pin",
-- which is exactly what every existing row already is; the calculator falls
-- back to the live setting for those, which is the behaviour they have had all
-- along. Backfilling today's fee onto historical trips would be worse than
-- leaving it null: it would assert a rate those trips were never priced at.
--
-- `commissionRate` already exists on Trip and was already written at creation.
-- It is not touched here; the calculator now simply honours it instead of
-- re-reading PLATFORM_COMMISSION.

ALTER TABLE "Trip" ADD COLUMN "bookingFeeRate" DOUBLE PRECISION;
ALTER TABLE "Trip" ADD COLUMN "platformFeePesewas" INTEGER;
