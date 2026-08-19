-- Runtime platform settings.
--
-- One row per overridden knob. Absence of a row means "use the env default", so
-- this table is empty on a fresh install and the platform behaves exactly as it
-- did before. Additive only.

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "updatedByEmail" TEXT,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);
