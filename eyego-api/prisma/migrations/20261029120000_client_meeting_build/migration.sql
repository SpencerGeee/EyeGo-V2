-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "boardingCode" TEXT,
ADD COLUMN     "corridorId" TEXT,
ADD COLUMN     "corridorSeatPricePesewas" INTEGER,
ADD COLUMN     "product" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "alightRatio" DOUBLE PRECISION,
ADD COLUMN     "boardRatio" DOUBLE PRECISION,
ADD COLUMN     "stopArrivedAt" TIMESTAMP(3),
ADD COLUMN     "walkUp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Corridor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "seatPricePesewas" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Corridor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandSignal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destLat" DOUBLE PRECISION,
    "destLng" DOUBLE PRECISION,
    "hourOfWeek" INTEGER NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Corridor_isActive_idx" ON "Corridor"("isActive");

-- CreateIndex
CREATE INDEX "DemandSignal_createdAt_idx" ON "DemandSignal"("createdAt");

-- CreateIndex
CREATE INDEX "DemandSignal_hourOfWeek_idx" ON "DemandSignal"("hourOfWeek");

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_corridorId_fkey" FOREIGN KEY ("corridorId") REFERENCES "Corridor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

