-- 2026-10-10 rival-parity pass (see state.md).
-- Waiting at the pickup, added to the hailed fare the driver collects.
ALTER TABLE "Booking" ADD COLUMN "waitFeePesewas" INTEGER NOT NULL DEFAULT 0;
-- Cash handed over when the driver had no change; the extra went to the rider's wallet.
ALTER TABLE "Booking" ADD COLUMN "cashReceivedPesewas" INTEGER;
-- The rider's note for the driver ("blue gate, opposite the pharmacy").
ALTER TABLE "Booking" ADD COLUMN "pickupNote" TEXT;
-- Rider-to-rider referrals.
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
-- The smallest expiry reminder already sent (30 / 7 / 1 / 0 days).
ALTER TABLE "DriverDocument" ADD COLUMN "expiryNoticeDays" INTEGER;
-- A ticket about a specific trip (lost item).
ALTER TABLE "SupportTicket" ADD COLUMN "tripId" TEXT;
CREATE INDEX "SupportTicket_tripId_idx" ON "SupportTicket"("tripId");
-- Last passed selfie identity check (provider-gated; null = never checked).
ALTER TABLE "Driver" ADD COLUMN "selfieVerifiedAt" TIMESTAMP(3);
