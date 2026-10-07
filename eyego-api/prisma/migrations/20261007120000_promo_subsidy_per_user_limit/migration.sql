-- The platform funds its own promos: a discount bigger than the seat's
-- commission is carried here and credited to the driver at settlement.
ALTER TABLE "Booking" ADD COLUMN "promoSubsidyPesewas" INTEGER NOT NULL DEFAULT 0;

-- Per-rider use limit for a promo code. 1 = once per rider (the default);
-- NULL = reusable without a per-rider limit.
ALTER TABLE "Promotion" ADD COLUMN "perUserLimit" INTEGER DEFAULT 1;
