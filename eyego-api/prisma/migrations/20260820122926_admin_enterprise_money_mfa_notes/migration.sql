-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "totpBackupCodes" TEXT,
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" BIGINT,
ADD COLUMN     "totpSecret" TEXT;

-- AlterTable
ALTER TABLE "SosEvent" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedById" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "RiderWalletTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountPesewas" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "balanceBeforePesewas" INTEGER NOT NULL,
    "balanceAfterPesewas" INTEGER NOT NULL,
    "bookingId" TEXT,
    "refundId" TEXT,
    "paystackRef" TEXT,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderWalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "amountPesewas" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL DEFAULT 'WALLET',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "providerRef" TEXT,
    "failureReason" TEXT,
    "adminId" TEXT,
    "adminEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "adminId" TEXT,
    "adminEmail" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiderWalletTransaction_userId_createdAt_idx" ON "RiderWalletTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderWalletTransaction_bookingId_idx" ON "RiderWalletTransaction"("bookingId");

-- CreateIndex
CREATE INDEX "Refund_bookingId_idx" ON "Refund"("bookingId");

-- CreateIndex
CREATE INDEX "Refund_userId_createdAt_idx" ON "Refund"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_createdAt_idx" ON "Refund"("createdAt");

-- CreateIndex
CREATE INDEX "AdminNote_subjectType_subjectId_createdAt_idx" ON "AdminNote"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "SosEvent_status_createdAt_idx" ON "SosEvent"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderWalletTransaction" ADD CONSTRAINT "RiderWalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderWalletTransaction" ADD CONSTRAINT "RiderWalletTransaction_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: `status` defaults to OPEN, but rows already carrying a resolvedAt
-- were resolved long ago. Without this every historically-handled alert
-- reappears at the top of the triage queue the moment this ships.
UPDATE "SosEvent" SET "status" = 'RESOLVED' WHERE "resolvedAt" IS NOT NULL;
