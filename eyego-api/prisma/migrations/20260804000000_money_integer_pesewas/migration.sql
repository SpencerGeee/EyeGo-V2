-- ═══════════════════════════════════════════════════════════════════════════
-- MONEY BECOMES INTEGER PESEWAS
--
-- Every monetary column moves from `DOUBLE PRECISION` cedis to `INTEGER`
-- pesewas (1 GH₵ = 100), and is renamed with a `Pesewas` suffix.
--
-- WHY THIS IS HAND-WRITTEN. `prisma migrate dev` generates a drop-and-add for
-- a type change like this, which would silently zero every existing fare,
-- wallet balance and receipt. Each column here is instead:
--
--     1. added alongside the old one,
--     2. backfilled with ROUND(old * 100),
--     3. and only then is the old column dropped.
--
-- Nothing is lost, and the conversion is a single statement per column that
-- can be read and checked.
--
-- WHY THE RENAME. Changing `fareAmount` from float-cedis to int-pesewas IN
-- PLACE would leave every read site compiling perfectly and charging 100× too
-- much. Renaming turns each unconverted site into a loud failure instead.
--
-- ROUNDING. `ROUND(x * 100)` is half-away-from-zero in Postgres for numeric,
-- which is what a person means by rounding money. Values already stored to 2dp
-- convert exactly; anything with float dust (25.499999999999996) lands on the
-- pesewa a human would have written.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── User ────────────────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "walletBalancePesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "User" SET "walletBalancePesewas" = ROUND("walletBalance"::numeric * 100);
ALTER TABLE "User" DROP COLUMN "walletBalance";

-- ── Driver ──────────────────────────────────────────────────────────────────
ALTER TABLE "Driver" ADD COLUMN "walletBalancePesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "Driver" SET "walletBalancePesewas" = ROUND("walletBalance"::numeric * 100);
ALTER TABLE "Driver" DROP COLUMN "walletBalance";

-- ── Trip: the rates locked in at trip creation ──────────────────────────────
ALTER TABLE "Trip" ADD COLUMN "baseFarePesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trip" ADD COLUMN "perKmRatePesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "Trip" SET
  "baseFarePesewas"  = ROUND("baseFare"::numeric * 100),
  "perKmRatePesewas" = ROUND("perKmRate"::numeric * 100);
ALTER TABLE "Trip" DROP COLUMN "baseFare";
ALTER TABLE "Trip" DROP COLUMN "perKmRate";
-- The defaults existed only to satisfy NOT NULL during the backfill.
ALTER TABLE "Trip" ALTER COLUMN "baseFarePesewas" DROP DEFAULT;
ALTER TABLE "Trip" ALTER COLUMN "perKmRatePesewas" DROP DEFAULT;

-- ── Booking ─────────────────────────────────────────────────────────────────
ALTER TABLE "Booking" ADD COLUMN "fareAmountPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "commissionAmountPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "cancellationFeePesewas" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "deviationSurchargePesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "Booking" SET
  "fareAmountPesewas"         = ROUND("fareAmount"::numeric * 100),
  "commissionAmountPesewas"   = ROUND("commissionAmount"::numeric * 100),
  "cancellationFeePesewas"    = ROUND("cancellationFee"::numeric * 100),
  "deviationSurchargePesewas" = ROUND("deviationSurcharge"::numeric * 100);
ALTER TABLE "Booking" DROP COLUMN "fareAmount";
ALTER TABLE "Booking" DROP COLUMN "commissionAmount";
ALTER TABLE "Booking" DROP COLUMN "cancellationFee";
ALTER TABLE "Booking" DROP COLUMN "deviationSurcharge";
ALTER TABLE "Booking" ALTER COLUMN "fareAmountPesewas" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "commissionAmountPesewas" DROP DEFAULT;

-- ── Receipt (rider-facing) ──────────────────────────────────────────────────
ALTER TABLE "Receipt" ADD COLUMN "totalPaidPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Receipt" ADD COLUMN "platformFeePesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Receipt" ADD COLUMN "driverEarningsPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Receipt" ADD COLUMN "discountAppliedPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Receipt" ADD COLUMN "cancellationFeePesewas" INTEGER;
UPDATE "Receipt" SET
  "totalPaidPesewas"       = ROUND("totalPaid"::numeric * 100),
  "platformFeePesewas"     = ROUND("platformFee"::numeric * 100),
  "driverEarningsPesewas"  = ROUND("driverEarnings"::numeric * 100),
  "discountAppliedPesewas" = ROUND("discountApplied"::numeric * 100),
  "cancellationFeePesewas" = ROUND("cancellationFee"::numeric * 100);
ALTER TABLE "Receipt" DROP COLUMN "totalPaid";
ALTER TABLE "Receipt" DROP COLUMN "platformFee";
ALTER TABLE "Receipt" DROP COLUMN "driverEarnings";
ALTER TABLE "Receipt" DROP COLUMN "discountApplied";
ALTER TABLE "Receipt" DROP COLUMN "cancellationFee";
ALTER TABLE "Receipt" ALTER COLUMN "totalPaidPesewas" DROP DEFAULT;
ALTER TABLE "Receipt" ALTER COLUMN "platformFeePesewas" DROP DEFAULT;
ALTER TABLE "Receipt" ALTER COLUMN "driverEarningsPesewas" DROP DEFAULT;

-- ── DriverReceipt (payout-facing) ───────────────────────────────────────────
ALTER TABLE "DriverReceipt" ADD COLUMN "totalEarningsPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverReceipt" ADD COLUMN "commissionDeductedPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverReceipt" ADD COLUMN "tipsReceivedPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DriverReceipt" ADD COLUMN "bonusAmountPesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "DriverReceipt" SET
  "totalEarningsPesewas"      = ROUND("totalEarnings"::numeric * 100),
  "commissionDeductedPesewas" = ROUND("commissionDeducted"::numeric * 100),
  "tipsReceivedPesewas"       = ROUND("tipsReceived"::numeric * 100),
  "bonusAmountPesewas"        = ROUND("bonusAmount"::numeric * 100);
ALTER TABLE "DriverReceipt" DROP COLUMN "totalEarnings";
ALTER TABLE "DriverReceipt" DROP COLUMN "commissionDeducted";
ALTER TABLE "DriverReceipt" DROP COLUMN "tipsReceived";
ALTER TABLE "DriverReceipt" DROP COLUMN "bonusAmount";
ALTER TABLE "DriverReceipt" ALTER COLUMN "totalEarningsPesewas" DROP DEFAULT;
ALTER TABLE "DriverReceipt" ALTER COLUMN "commissionDeductedPesewas" DROP DEFAULT;

-- ── PaymentTransaction ──────────────────────────────────────────────────────
ALTER TABLE "PaymentTransaction" ADD COLUMN "amountPesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "PaymentTransaction" SET "amountPesewas" = ROUND("amount"::numeric * 100);
ALTER TABLE "PaymentTransaction" DROP COLUMN "amount";
ALTER TABLE "PaymentTransaction" ALTER COLUMN "amountPesewas" DROP DEFAULT;

-- ── WalletTransaction (the ledger) ──────────────────────────────────────────
ALTER TABLE "WalletTransaction" ADD COLUMN "amountPesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WalletTransaction" ADD COLUMN "balanceBeforePesewas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WalletTransaction" ADD COLUMN "balanceAfterPesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "WalletTransaction" SET
  "amountPesewas"        = ROUND("amount"::numeric * 100),
  "balanceBeforePesewas" = ROUND("balanceBefore"::numeric * 100),
  "balanceAfterPesewas"  = ROUND("balanceAfter"::numeric * 100);
ALTER TABLE "WalletTransaction" DROP COLUMN "amount";
ALTER TABLE "WalletTransaction" DROP COLUMN "balanceBefore";
ALTER TABLE "WalletTransaction" DROP COLUMN "balanceAfter";
ALTER TABLE "WalletTransaction" ALTER COLUMN "amountPesewas" DROP DEFAULT;
ALTER TABLE "WalletTransaction" ALTER COLUMN "balanceBeforePesewas" DROP DEFAULT;
ALTER TABLE "WalletTransaction" ALTER COLUMN "balanceAfterPesewas" DROP DEFAULT;

-- ── DriverShift ─────────────────────────────────────────────────────────────
ALTER TABLE "DriverShift" ADD COLUMN "earningsPesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "DriverShift" SET "earningsPesewas" = ROUND("earnings"::numeric * 100);
ALTER TABLE "DriverShift" DROP COLUMN "earnings";

-- ── Promotion ───────────────────────────────────────────────────────────────
ALTER TABLE "Promotion" ADD COLUMN "maxDiscountPesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "Promotion" SET "maxDiscountPesewas" = ROUND("maxDiscount"::numeric * 100);
ALTER TABLE "Promotion" DROP COLUMN "maxDiscount";
ALTER TABLE "Promotion" ALTER COLUMN "maxDiscountPesewas" DROP DEFAULT;

-- ── ReferralBonus ───────────────────────────────────────────────────────────
ALTER TABLE "ReferralBonus" ADD COLUMN "amountPesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "ReferralBonus" SET "amountPesewas" = ROUND("amount"::numeric * 100);
ALTER TABLE "ReferralBonus" DROP COLUMN "amount";
ALTER TABLE "ReferralBonus" ALTER COLUMN "amountPesewas" DROP DEFAULT;

-- ── DriverQuest / DriverQuestProgress ───────────────────────────────────────
-- `target` and `current` are the awkward pair: one column, two units. A
-- RIDES_COUNT quest counts rides and must NOT be multiplied; an EARNINGS quest
-- holds money and must be. Getting this backwards makes a "10 rides" goal need
-- 1000 rides, or a GH₵200 goal fire after GH₵2.
ALTER TABLE "DriverQuest" ADD COLUMN "rewardAmountPesewas" INTEGER NOT NULL DEFAULT 0;
UPDATE "DriverQuest" SET "rewardAmountPesewas" = ROUND("rewardAmount"::numeric * 100);
ALTER TABLE "DriverQuest" DROP COLUMN "rewardAmount";
ALTER TABLE "DriverQuest" ALTER COLUMN "rewardAmountPesewas" DROP DEFAULT;

ALTER TABLE "DriverQuest" ADD COLUMN "target_int" INTEGER NOT NULL DEFAULT 0;
UPDATE "DriverQuest" SET "target_int" =
  CASE WHEN "type" = 'EARNINGS' THEN ROUND("target"::numeric * 100) ELSE ROUND("target"::numeric) END;
ALTER TABLE "DriverQuest" DROP COLUMN "target";
ALTER TABLE "DriverQuest" RENAME COLUMN "target_int" TO "target";
ALTER TABLE "DriverQuest" ALTER COLUMN "target" DROP DEFAULT;

ALTER TABLE "DriverQuestProgress" ADD COLUMN "current_int" INTEGER NOT NULL DEFAULT 0;
UPDATE "DriverQuestProgress" p SET "current_int" =
  CASE WHEN q."type" = 'EARNINGS' THEN ROUND(p."current"::numeric * 100) ELSE ROUND(p."current"::numeric) END
  FROM "DriverQuest" q WHERE q."id" = p."questId";
ALTER TABLE "DriverQuestProgress" DROP COLUMN "current";
ALTER TABLE "DriverQuestProgress" RENAME COLUMN "current_int" TO "current";
