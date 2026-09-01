-- Fraud signals on Driver.
--
-- The driver app has detected OS mock-location providers since it was written
-- and did nothing with the answer: `isMocked` was local component state, so the
-- spoofing driver's phone knew and the platform did not. These columns carry it
-- somewhere it can be acted on.
--
-- Deliberately not proof of anything on its own — a patched client can decline
-- to report at all. This catches the casual case and gives ops a signal.
--
-- `payoutHold` is separate from `status` on purpose: suspending an account
-- stops a driver earning, while a payout hold lets them keep working while the
-- money is investigated.

ALTER TABLE "Driver"
  ADD COLUMN "mockLocationAt"   TIMESTAMP(3),
  ADD COLUMN "mockLocationHits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payoutHold"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payoutHoldReason" TEXT;
